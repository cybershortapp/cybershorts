// only the five weights we use, imported one by one so the other weights aren't bundled into the app
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { LibreBaskerville_400Regular } from '@expo-google-fonts/libre-baskerville/400Regular';
import { LibreBaskerville_400Regular_Italic } from '@expo-google-fonts/libre-baskerville/400Regular_Italic';
import { LibreBaskerville_700Bold } from '@expo-google-fonts/libre-baskerville/700Bold';
import { PlayfairDisplay_900Black } from '@expo-google-fonts/playfair-display/900Black';
import { UnifrakturMaguntia_400Regular } from '@expo-google-fonts/unifrakturmaguntia/400Regular';
import { CormorantGaramond_700Bold } from '@expo-google-fonts/cormorant-garamond/700Bold';
import { Bangers_400Regular } from '@expo-google-fonts/bangers/400Regular';
import { ComicNeue_700Bold } from '@expo-google-fonts/comic-neue/700Bold';
import { Rye_400Regular } from '@expo-google-fonts/rye/400Regular';
import { SpecialElite_400Regular } from '@expo-google-fonts/special-elite/400Regular';
import { UncialAntiqua_400Regular } from '@expo-google-fonts/uncial-antiqua/400Regular';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AshIntro } from './src/components/AshIntro';
import { DeckCard } from './src/components/DeckCard';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { GameCard } from './src/components/Games';
import { Header } from './src/components/Header';
import { Preferences } from './src/components/Preferences';
import { Welcome, welcomeDone } from './src/components/Welcome';
import { StoryCard } from './src/components/StoryCard';
import { alertsAvailable, enableAlerts, onAlertTapped, refreshAlerts } from './src/lib/notifications';
import { cleanStories } from './src/lib/clean';
import { type Deck, deckSeen, extrasAllReady, fetchDailyCards, fetchDeck, fetchGamePool, GAME_GAP, gameSeen, gamesPlayedToday, gamesQuotaToday, markCardRead, markDeckSeen, markGameSeen, markPinnedSeen, pinnedSeen, type PoolGame } from './src/lib/extras';
import { useCardLayout } from './src/lib/layout';
import { installCrashHandler } from './src/lib/crash';
import { cleanTerm, getPrefs, prefsLoaded, usePrefs } from './src/lib/prefs';
import { getRegion, regionCountries } from './src/lib/region';
import { useSaved } from './src/lib/saved';
import { configMissing, supabase } from './src/lib/supabase';
import { storyFields, tintMissing, type Filter, type Story } from './src/lib/types';
import { deepen, F, type Palette, storyTint, useTheme } from './src/theme';

const FIRST_PAGE = 20; // small first page so opening and pull-to-refresh are quick
const PAGE_SIZE = 40; // then 40 at a time, loaded quietly as the reader nears the end
const LOAD_MORE_AT = 8; // start fetching the next page this many cards before the end
const MAX_CARDS = 600; // about 3 weeks of news in one sitting; keeps memory use low
const REFRESH_AFTER_MS = 5 * 60 * 1000; // reload when the app is reopened after 5 minutes
const SEEN_KEY = 'seen-upto'; // newest story the reader has been shown, for the NEW tags

/** One page of the feed: a story, a trending deck, or a short game about the story before it. */
type FeedItem =
  | { kind: 'story'; key: string; story: Story }
  | { kind: 'deck'; key: string; deck: Deck }
  | { kind: 'game'; key: string; game: PoolGame };

const EMPTY_TEXT: Partial<Record<Filter, string>> = {
  'Zero-day': "No zero-days right now. Stay tuned: we'll flag the next one the moment it's reported.",
  'For you': "Nothing about your products yet. Stay tuned: we'll show it here the moment it's reported.",
  Critical: 'No critical stories right now. Stay tuned.',
  Saved: 'Tap the bookmark on any story to save it here.',
};

/** "For you": stories tagged with the reader's products, or mentioning their own keywords. */
function forYouFilter() {
  const p = getPrefs();
  const conds: string[] = [];
  if (p.products.length) conds.push(`products.ov.{${p.products.map((x) => `"${x.replace(/"/g, '')}"`).join(',')}}`);
  for (const t of p.terms) {
    const v = cleanTerm(t);
    if (v) conds.push(`headline.ilike."*${v}*"`, `technical.ilike."*${v}*"`);
  }
  return conds.join(',');
}

function Main() {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { savedIds, toggleSaved } = useSaved();
  const prefs = usePrefs();
  // the app opens straight on the news
  const [view, setView] = useState<'feed' | 'prefs'>('feed');
  // first open: a short welcome (null while we check whether it was already seen)
  const [welcome, setWelcome] = useState<boolean | null>(null);
  useEffect(() => {
    welcomeDone().then((done) => setWelcome(!done));
  }, []);
  const [filter, setFilter] = useState<Filter>('All');
  const [ready, setReady] = useState(prefsLoaded());
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [index, setIndex] = useState(0);
  // search: the box in the header; results show as normal cards
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const beforeSearch = useRef<Filter>('All');
  const lastLoaded = useRef(0);
  const listRef = useRef<FlatList<FeedItem>>(null);
  const latestRef = useRef<() => void>(() => {});
  const pendingJump = useRef<string | null>(null);
  const savedKey = filter === 'Saved' ? savedIds.join(',') : '';
  const prefsKey = filter === 'For you' ? [...prefs.products, ...prefs.terms].join('|') : '';
  const searchKey = filter === 'Search' ? searchTerm : '';
  const region = prefs.region || getRegion(); // changes when they pick another region in Preferences
  const seenBefore = useRef<string | null>(null); // stories newer than this get a NEW tag
  // each tab remembers its cards and position while the app stays open; cleared on a fresh start
  const tabMemory = useRef(new Map<Filter, { stories: Story[]; index: number }>());
  const shownFilter = useRef<Filter | null>(null);
  const indexRef = useRef(0);
  const storiesRef = useRef<Story[]>([]);
  const firstLoad = useRef(true);
  const loadingMore = useRef(false);
  const noMore = useRef(new Set<Filter>()); // tabs where every story is already loaded
  // games and the trending deck (release 1.0.4)
  const [pool, setPool] = useState<PoolGame[]>([]);
  const [daily, setDaily] = useState<{ tip: Story | null; history: Story | null }>({ tip: null, history: null });
  const placedSlots = useRef<string[]>([]); // the game given to each game spot, so games never jump around
  const pinnedNow = useRef(new Set<string>()); // tip/history pinned near the top in this visit
  const [deck, setDeck] = useState<Deck | null>(null);
  const [extrasLoaded, setExtrasLoaded] = useState(false);
  const placedDeck = useRef<string | null>(null);
  const feedRef = useRef<FeedItem[]>([]);

  // once saved preferences are read: start on "For you" if they follow products, otherwise "All"
  useEffect(() => {
    if (ready || !prefsLoaded()) return;
    if (prefs.products.length + prefs.terms.length > 0) setFilter('For you');
    setReady(true);
  }, [prefs, ready]);
  useEffect(() => {
    if (!ready && prefsLoaded()) {
      if (getPrefs().products.length + getPrefs().terms.length > 0) setFilter('For you');
      setReady(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // one page of stories for the current tab, starting at card number `from`
  const pageQuery = useCallback(
    (from: number, size = PAGE_SIZE) => {
      // newest PUBLISHED first, so the order always matches the "x min ago" shown on each card
      let query = supabase
        .from('stories')
        .select(storyFields())
        .order('published_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + size - 1);
      // news for everyone plus the reader's own country (UK readers don't get Indian UPI scams, and the other way round)
      if (filter !== 'Saved') query = query.in('country', regionCountries(region));
      if (filter === 'Search') {
        if (searchTerm.length < 2) return null;
        query = query.or(`headline.ilike.*${searchTerm}*,technical.ilike.*${searchTerm}*,source.ilike.*${searchTerm}*`);
      } else if (filter === 'Saved') query = query.in('id', savedIds);
      else if (filter === 'Critical') query = query.eq('severity', 'Critical');
      else if (filter === 'Zero-day') query = query.eq('zero_day', true);
      else if (filter === 'For you') {
        const f = forYouFilter();
        if (!f) return null;
        query = query.or(f);
      } else if (filter !== 'All') query = query.eq('category', filter);
      return query;
    },
    [filter, savedKey, prefsKey, searchKey, region], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const load = useCallback(async (opts?: { markSeen?: boolean }) => {
    if (configMissing) {
      setError('App settings are missing. Check the .env file in the app folder.');
      return;
    }
    if (filter === 'Saved' && savedIds.length === 0) {
      setError(null);
      setStories([]);
      return;
    }
    const query = pageQuery(0, FIRST_PAGE);
    if (!query) {
      setError(null);
      setStories([]);
      return;
    }
    const { data, error: err } = await query;
    if (tintMissing(err)) return load(opts); // database without the colour column yet: ask again without it
    if (err) {
      setError("Couldn't load stories. Check your connection and try again.");
      return;
    }
    let rows = cleanStories(data as unknown as Story[]);
    lastLoaded.current = Date.now();
    if (rows.length < FIRST_PAGE) noMore.current.add(filter);
    else noMore.current.delete(filter);
    if (opts?.markSeen) {
      // remember the newest story that exists now; anything newer than the previous visit gets a NEW tag
      const { data: newest } = await supabase.from('stories').select('created_at').order('created_at', { ascending: false }).limit(1);
      const top = (newest as { created_at: string }[] | null)?.[0]?.created_at;
      if (top) {
        seenBefore.current = await AsyncStorage.getItem(SEEN_KEY).catch(() => null);
        AsyncStorage.setItem(SEEN_KEY, top).catch(() => {});
      }
    }
    setError(null);
    setStories(rows);
  }, [filter, savedKey, prefsKey, searchKey, pageQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // search as you type, once the typing pauses
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(cleanTerm(query)), 400);
    return () => clearTimeout(t);
  }, [query]);

  // near the end of the loaded cards: quietly fetch the next page and add it to the bottom
  const loadMore = useCallback(async () => {
    const f = filter;
    if (loadingMore.current || noMore.current.has(f) || filter === 'Saved') return;
    const have = storiesRef.current.length;
    if (have === 0 || have >= MAX_CARDS) return;
    const query = pageQuery(have);
    if (!query) return;
    loadingMore.current = true;
    try {
      const { data, error: err } = await query;
      if (tintMissing(err)) noMore.current.delete(f); // asked for the colour column; the next scroll asks without it
      if (err || shownFilter.current !== f) return;
      const rows = cleanStories(data as unknown as Story[]);
      if (rows.length < PAGE_SIZE) noMore.current.add(f);
      if (rows.length) {
        setStories((cur) => {
          const ids = new Set(cur.map((x) => x.id));
          const extra = rows.filter((x) => !ids.has(x.id)); // skip any that moved pages while reading
          return extra.length ? [...cur, ...extra] : cur;
        });
      }
    } finally {
      loadingMore.current = false;
    }
  }, [filter, pageQuery]);

  // jump to a card without ever asking for one that doesn't exist (that throws and closes the app)
  const safeScrollTo = (i: number) => {
    const n = feedRef.current.length;
    if (!listRef.current || n === 0) return;
    try {
      listRef.current.scrollToIndex({ index: Math.max(0, Math.min(i, n - 1)), animated: false });
    } catch {}
  };

  const toTop = () => {
    setIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    storiesRef.current = stories;
  }, [stories]);

  // a remembered tab is out of date once its contents change (new bookmark, new products)
  useEffect(() => {
    tabMemory.current.delete('Saved');
  }, [savedIds]);
  useEffect(() => {
    tabMemory.current.delete('For you');
  }, [prefs.products, prefs.terms]);
  useEffect(() => {
    tabMemory.current.clear();
  }, [region]);

  // switching tabs: remember where the reader was on the tab they are leaving
  const changeFilter = useCallback(
    (f: Filter) => {
      if (f === shownFilter.current) {
        latestRef.current(); // tap the tab you're on: back to the newest cards
        return;
      }
      if (shownFilter.current && storiesRef.current.length) {
        tabMemory.current.set(shownFilter.current, { stories: storiesRef.current, index: indexRef.current });
      }
      setFilter(f);
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;
    const tabChanged = shownFilter.current !== filter;
    shownFilter.current = filter;
    const saved = tabChanged ? tabMemory.current.get(filter) : undefined;
    if (saved) {
      // back to a tab visited earlier: same cards, same position, no reload
      setStories(saved.stories);
      setIndex(saved.index);
      setLoading(false);
      storiesRef.current = saved.stories;
      setTimeout(() => safeScrollTo(saved.index), 0);
      return;
    }
    setLoading(true);
    toTop();
    const markSeen = firstLoad.current;
    firstLoad.current = false;
    load({ markSeen }).finally(() => setLoading(false));
  }, [load, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // readers who skipped the welcome (or had the app before it): after a moment, Android asks once
  // "Allow CyberSid to send notifications?" (the welcome's last screen asks itself)
  useEffect(() => {
    if (!ready || welcome !== false || getPrefs().alertsAsked || !alertsAvailable || !getPrefs().alerts) return;
    const t = setTimeout(() => enableAlerts(), 2500);
    return () => clearTimeout(t);
  }, [ready, welcome]);

  // Android back button: settings or search close first, then back to the latest story, then the app closes
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (welcome) return false;
      if (view === 'prefs') {
        setView('feed');
        return true;
      }
      if (searching) {
        setSearching(false);
        tabMemory.current.delete('Search');
        changeFilter(beforeSearch.current);
        return true;
      }
      if (index > 0) {
        latestRef.current();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [welcome, view, searching, index]); // eslint-disable-line react-hooks/exhaustive-deps


  // back in the app after 5+ minutes: fresh stories, starting from the newest (works for every category)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastLoaded.current > REFRESH_AFTER_MS) {
        // away 5+ minutes: every tab starts fresh, newest first
        tabMemory.current.clear();
        load({ markSeen: true }).then(toTop);
      }
    });
    return () => sub.remove();
  }, [load]);

  // phone alerts: refresh the push address quietly, and open the story when an alert is tapped
  useEffect(() => {
    refreshAlerts();
    return onAlertTapped(async (id) => {
      pendingJump.current = id;
      setView('feed');
      changeFilter('All');
      const { data } = await supabase.from('stories').select(storyFields()).eq('id', id).maybeSingle();
      const [story] = cleanStories(data ? [data as unknown as Story] : []);
      if (story) setStories((cur) => (cur.some((x) => x.id === id) ? cur : [story, ...cur]));
    });
  }, []);


  // what this phone has already played and seen
  useEffect(() => {
    extrasAllReady.then(() => setExtrasLoaded(true));
  }, []);
  // on each fresh load: the trending deck, the games pool and today's tip and history for this region
  useEffect(() => {
    if (loading || (filter !== 'All' && filter !== 'For you')) return;
    const countries = regionCountries(region);
    fetchDeck(countries).then(setDeck);
    fetchGamePool(countries).then(setPool);
    fetchDailyCards(countries, storyFields()).then((d) => {
      const [tip, history] = cleanStories([d.tip, d.history].filter(Boolean) as Story[]).reduce<(Story | null)[]>(
        (acc, s) => (s.source === 'CyberSid Tips' ? [s, acc[1]] : [acc[0], s]), [null, null]);
      setDaily({ tip, history });
    });
  }, [filter, loading, region]);

  // The feed, built from the stories:
  // - after 9am, today's cyber tip comes after the 2nd card and today's history card after the 4th,
  //   until they've been read once today (before 9am they aren't out yet)
  // - the trending deck after the 6th card (All tab), until it's been seen
  // - games, whatever the news: the first after card 4, then one every 8 cards. Everyone gets at least
  //   3 a day; readers who read a lot get one more per 20 cards, up to 6. Never a game already played,
  //   never the same kind twice in a row. A game keeps its spot once given.
  const feed = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    const extrasOn = (filter === 'All' || filter === 'For you') && extrasLoaded;
    const afterNine = new Date().getHours() >= 9;
    const pin = (s: Story | null) => !!s && extrasOn && filter === 'All' && afterNine && (pinnedNow.current.has(s.id) || !pinnedSeen(s.id));
    const pinTip = pin(daily.tip) ? daily.tip : null;
    const pinHistory = pin(daily.history) ? daily.history : null;
    if (pinTip) pinnedNow.current.add(pinTip.id);
    if (pinHistory) pinnedNow.current.add(pinHistory.id);
    const skip = new Set([pinTip?.id, pinHistory?.id].filter(Boolean) as string[]);
    const unplayed = pool.filter((g) => !gameSeen(g.id) || placedSlots.current.includes(g.id));
    let left = gamesQuotaToday() - gamesPlayedToday() - placedSlots.current.filter((id) => !gameSeen(id)).length;
    let slot = 0;
    let lastStyle = '';
    let n = 0; // stories so far
    for (const s of stories) {
      if (skip.has(s.id)) continue;
      out.push({ kind: 'story', key: s.id, story: s });
      n++;
      if (n === 2 && pinTip) out.push({ kind: 'story', key: pinTip.id, story: pinTip });
      if (n === 4 && pinHistory) out.push({ kind: 'story', key: pinHistory.id, story: pinHistory });
      if (n === 6 && extrasOn && filter === 'All' && deck && (placedDeck.current === deck.id || !deckSeen(deck.id))) {
        placedDeck.current = deck.id;
        out.push({ kind: 'deck', key: `deck-${deck.id}`, deck });
      }
      if (!extrasOn || !prefs.games || n < 4 || (n - 4) % GAME_GAP !== 0) continue;
      // a game spot: the game it already had, or a new one if today's allowance isn't used up
      let g = pool.find((x) => x.id === placedSlots.current[slot]);
      if (!g && left > 0) {
        const used = new Set(placedSlots.current);
        g = unplayed.find((x) => !used.has(x.id) && x.style !== lastStyle) ?? unplayed.find((x) => !used.has(x.id));
        if (g) {
          placedSlots.current[slot] = g.id;
          left--;
        }
      }
      if (g) {
        out.push({ kind: 'game', key: `game-${g.id}`, game: g });
        lastStyle = g.style;
      }
      slot++;
    }
    return out;
  }, [stories, pool, deck, daily, filter, prefs.games, extrasLoaded]);
  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);
  // what's been on screen: games and the deck count as seen, tips and history as read today,
  // and every card read counts towards a busy reader's extra games
  useEffect(() => {
    const it = feed[index];
    if (!it) return;
    markCardRead();
    if (it.kind === 'game') markGameSeen(it.game.id);
    if (it.kind === 'deck') markDeckSeen(it.deck.id);
    if (it.kind === 'story' && (it.story.source === 'CyberSid Tips' || it.story.source === 'CyberSid History')) markPinnedSeen(it.story.id);
  }, [index, feed]);

  // jump to the story picked in the brief once the feed is on screen
  useEffect(() => {
    if (view !== 'feed' || !pendingJump.current || pageHeight === 0 || filter !== 'All') return;
    const i = feed.findIndex((it) => it.kind === 'story' && it.story.id === pendingJump.current);
    pendingJump.current = null;
    if (i > 0) setTimeout(() => safeScrollTo(i), 50);
  }, [view, feed, pageHeight, filter]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null && i >= 0) setIndex(i);
  }).current;

  useEffect(() => {
    if (view === 'feed' && feed.length && index >= feed.length - LOAD_MORE_AT) loadMore();
  }, [index, feed.length, view, loadMore]);

  // download the next few pictures while the reader is still on this card, so they appear instantly
  useEffect(() => {
    const next = feed
      .slice(index + 1, index + 4)
      .flatMap((it) => (it.kind === 'story' ? [it.story.image_url] : it.kind === 'deck' ? it.deck.slides.map((s) => s.image) : []))
      .filter((u): u is string => !!u);
    if (next.length) Image.prefetch(next, 'memory-disk').catch(() => {});
  }, [index, feed]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    toTop();
    setRefreshing(false);
  };
  // "Latest" button and tapping the current tab: jump to the first card and check for new stories
  const goLatest = () => {
    toTop();
    onRefresh();
  };
  latestRef.current = goLatest;

  // stable list props, so only the cards that actually changed are redrawn
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);
  // NEW tags, and a "caught up" note on the first story they had already seen
  const marker = seenBefore.current;
  const firstOld = marker ? feed.findIndex((x) => x.kind === 'story' && x.story.created_at <= marker) : -1;
  // Vivid: the screen takes a deep shade of the colour of the story on screen
  const onScreen = feed[index];
  const screenColour = C.mode === 'vivid' && view === 'feed' && onScreen?.kind === 'story' ? deepen(storyTint(onScreen.story)) : C.mode === 'vivid' && onScreen ? '#0A0F1F' : C.bg;
  const goNext = (i: number) => {
    const n = feedRef.current.length;
    if (i + 1 < n) listRef.current?.scrollToIndex({ index: i + 1, animated: true });
  };
  const renderItem = useCallback(
    ({ item, index: i }: { item: FeedItem; index: number }) => {
      if (item.kind === 'deck' || item.kind === 'game') {
        return (
          <ErrorBoundary resetKey={item.key} fallback={() => <BrokenCard height={pageHeight} />}>
            <ExtraPage height={pageHeight}>
              {(w, h) =>
                item.kind === 'deck' ? (
                  <DeckCard deck={item.deck} width={w} height={h} onDone={() => goNext(i)} />
                ) : (
                  <GameCard game={item.game} headline={item.game.headline} width={w} height={h} active={index === i} />
                )
              }
            </ExtraPage>
          </ErrorBoundary>
        );
      }
      return (
        <ErrorBoundary resetKey={item.key} fallback={() => <BrokenCard height={pageHeight} />}>
          <StoryCard
            story={item.story}
            height={pageHeight}
            active={index === i}
            saved={savedSet.has(item.story.id)}
            onToggleSave={toggleSaved}
            isNew={!!marker && item.story.created_at > marker}
            caughtUp={i === firstOld && i > 0}
            onNext={() => goNext(i)}
          />
        </ErrorBoundary>
      );
    },
    [pageHeight, index, savedSet, toggleSaved, marker, firstOld], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const extraData = `${index}|${savedIds.length}|${savedIds[0] ?? ''}|${marker}|${firstOld}`;

  const counter = feed.length ? `${String(index + 1).padStart(2, '0')} / ${String(feed.length).padStart(2, '0')}` : '';

  let content;
  if (loading && stories.length === 0) {
    content = <ActivityIndicator style={styles.center} color={C.brand} />;
  } else if (error) {
    content = (
      <View style={styles.center}>
        <Text style={styles.message}>{error}</Text>
        <Pressable onPress={onRefresh} style={styles.retry}>
          <Text style={{ color: C.text, fontFamily: F.label }}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (view === 'prefs') {
    content = <Preferences onShowWelcome={() => setWelcome(true)} onDone={() => { setView('feed'); tabMemory.current.delete('For you'); if (prefs.products.length + prefs.terms.length) changeFilter('For you'); }} />;
  } else if (stories.length === 0) {
    const noPrefs = filter === 'For you' && prefs.products.length + prefs.terms.length === 0;
    content = (
      <View style={styles.center}>
        <Text style={styles.message}>
          {noPrefs
            ? 'Tell us which products you use (Defender, Mimecast, Fortinet...) and their news will show up here.'
            : filter === 'Search'
              ? searchTerm.length < 2
                ? 'Search every story: try a product, a company or a CVE number.'
                : `No stories match "${searchTerm}".`
              : EMPTY_TEXT[filter] ?? `No ${filter === 'All' ? '' : filter + ' '}stories right now. Stay tuned.`}
        </Text>
        {noPrefs && (
          <Pressable onPress={() => setView('prefs')} style={[styles.retry, { backgroundColor: C.brand, borderColor: C.brand }]}>
            <Text style={{ color: C.onBrand, fontFamily: F.label }}>Choose my products</Text>
          </Pressable>
        )}
      </View>
    );
  } else if (pageHeight > 0) {
    content = (
      <FlatList
        ref={listRef}
        data={feed}
        keyExtractor={(it) => it.key}
        renderItem={renderItem}
        extraData={extraData}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        windowSize={3}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        getItemLayout={(_, i) => ({ length: pageHeight, offset: pageHeight * i, index: i })}
        onScrollToIndexFailed={() => {}}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} colors={[C.glass ? '#000000' : C.brand]} progressBackgroundColor={C.glass ? '#FFFFFF' : C.surface} />}
      />
    );
  }

  if (welcome) return <Welcome onDone={() => setWelcome(false)} />;

  const header = (
    <Header
        view={view}
        onSaved={() => {
          setView('feed');
          if (searching) {
            setSearching(false);
            tabMemory.current.delete('Search');
          }
          // tap again to leave Saved and go back to the news
          if (filter === 'Saved') changeFilter(prefs.products.length + prefs.terms.length ? 'For you' : 'All');
          else changeFilter('Saved');
        }}
        onPrefs={() => setView('prefs')}
        hasPrefs={prefs.products.length + prefs.terms.length > 0}
        filter={filter}
        onFilterChange={changeFilter}
        counter={counter}
        searching={searching}
        query={query}
        onQueryChange={setQuery}
        onSearchOpen={() => {
          setView('feed');
          if (filter !== 'Search') beforeSearch.current = filter;
          setQuery('');
          setSearchTerm('');
          tabMemory.current.delete('Search');
          setSearching(true);
          changeFilter('Search');
        }}
        onSearchClose={() => {
          setSearching(false);
          tabMemory.current.delete('Search');
          changeFilter(beforeSearch.current);
        }}
      />
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.mode === 'aurora' ? '#0A0F2C' : C.bg }]} edges={['top', 'bottom']}>
      {C.mode === 'aurora' && (
        <Image source={require('./assets/aurora.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      {C.mode === 'vivid' && <ScreenColour colour={screenColour} />}
      {header}
      <View style={styles.feed} onLayout={(e) => setPageHeight(Math.floor(e.nativeEvent.layout.height))}>
        {content}
        {view === 'feed' && index >= 2 && stories.length > 0 && !loading && (
          <Pressable onPress={goLatest} style={styles.latest} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to the latest stories">
            <MaterialCommunityIcons name="arrow-up" size={16} color={C.onBrand} />
            <Text style={styles.latestText}>Latest</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

/** Vivid: the screen behind the cards fades smoothly to the colour of the story on screen. */
function ScreenColour({ colour }: { colour: string }) {
  const [shown, setShown] = useState({ from: colour, to: colour });
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (colour === shown.to) return;
    setShown((cur) => ({ from: cur.to, to: colour }));
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [colour]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: shown.from }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: shown.to, opacity: fade }]} />
    </View>
  );
}

/** A full page in the feed for a deck or a game, the same size as a story card. */
function ExtraPage({ height, children }: { height: number; children: (width: number, height: number) => React.ReactNode }) {
  const L = useCardLayout(height);
  return <View style={{ height, alignItems: 'center', paddingVertical: 8 }}>{children(L.cardWidth, height - 16)}</View>;
}

/** Shown in place of one story that couldn't be drawn, so the rest of the feed keeps working. */
function BrokenCard({ height }: { height: number }) {
  const C = useTheme();
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ color: C.muted, textAlign: 'center', fontSize: 15, lineHeight: 22 }}>
        This story couldn't be shown. Swipe on for the next one.
      </Text>
    </View>
  );
}

/** Last safety net: never a blank white screen. */
function AppCrashed({ onReload, message }: { onReload: () => void; message?: string }) {
  const C = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ color: C.text, fontFamily: F.head, fontSize: 18, textAlign: 'center' }}>Something went wrong</Text>
      <Text style={{ color: C.muted, textAlign: 'center', marginTop: 8, fontSize: 14.5, lineHeight: 21 }}>
        Sorry about that. Tap below to reload the news.
      </Text>
      {!!message && (
        <Text style={{ color: C.muted, textAlign: 'center', marginTop: 14, fontSize: 11.5, lineHeight: 16, opacity: 0.8 }} selectable>
          {message}
        </Text>
      )}
      <Pressable onPress={onReload} style={{ marginTop: 18, backgroundColor: C.brand, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 }}>
        <Text style={{ color: C.onBrand, fontFamily: F.label }}>Reload</Text>
      </Pressable>
    </SafeAreaView>
  );
}

// keep the splash screen up until the logo fonts are ready, so text is never measured with the wrong font
SplashScreen.preventAutoHideAsync().catch(() => {});

// Phones stay upright (the cards are made for it). Tablets and foldables can turn, which Google asks for
// on large screens, so the lock is only applied when the shorter side is under 600dp.
{
  const { width, height } = Dimensions.get('screen');
  if (Math.min(width, height) < 600) {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold,
    // card styles: Newspaper (Baskerville, Playfair, the masthead) and Terminal (JetBrains Mono)
    LibreBaskerville_400Regular, LibreBaskerville_400Regular_Italic, LibreBaskerville_700Bold, PlayfairDisplay_900Black,
    UnifrakturMaguntia_400Regular, JetBrainsMono_400Regular, JetBrainsMono_700Bold,
    CormorantGaramond_700Bold, // Ronin
    Rye_400Regular, SpecialElite_400Regular, Bangers_400Regular, ComicNeue_700Bold, // trending deck looks
    UncialAntiqua_400Regular, // Viking raid chain
  });
  const [timedOut, setTimedOut] = useState(false);
  const C = useTheme();
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000); // never wait more than 3 seconds
    return () => clearTimeout(t);
  }, []);
  const ready = fontsLoaded || !!fontError || timedOut;
  const [fatal, setFatal] = useState<string | null>(null);
  const [run, setRun] = useState(0); // bumping this rebuilds every screen from scratch
  const [intro, setIntro] = useState(true); // the ash opening, once per start; the news loads underneath
  useEffect(() => installCrashHandler(setFatal), []);
  const reload = () => {
    setFatal(null);
    setRun((r) => r + 1);
  };
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider style={{ backgroundColor: C.bg }}>
      <StatusBar style={C.dark ? 'light' : 'dark'} />
      {fatal ? (
        <AppCrashed onReload={reload} message={fatal} />
      ) : (
        <ErrorBoundary key={run} fallback={() => <AppCrashed onReload={reload} />}>
          <Main />
        </ErrorBoundary>
      )}
      {intro && <AshIntro onDone={() => setIntro(false)} />}
    </SafeAreaProvider>
  );
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  feed: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 15, textAlign: 'center', lineHeight: 22, color: C.muted, fontFamily: F.body },
  retry: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  latest: {
    position: 'absolute', top: 10, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: C.brand,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 6,
  },
  latestText: { color: C.onBrand, fontFamily: F.label, fontSize: 13.5 },
});
