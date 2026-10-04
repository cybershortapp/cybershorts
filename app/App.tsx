import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, useFonts } from '@expo-google-fonts/poppins';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { Header } from './src/components/Header';
import { Preferences } from './src/components/Preferences';
import { StoryCard } from './src/components/StoryCard';
import { alertsAvailable, enableAlerts, onAlertTapped, refreshAlerts } from './src/lib/notifications';
import { cleanStories } from './src/lib/clean';
import { installCrashHandler } from './src/lib/crash';
import { cleanTerm, getPrefs, prefsLoaded, usePrefs } from './src/lib/prefs';
import { useSaved } from './src/lib/saved';
import { configMissing, supabase } from './src/lib/supabase';
import { STORY_FIELDS, type Filter, type Story } from './src/lib/types';
import { F, type Palette, useTheme } from './src/theme';

const FIRST_PAGE = 20; // small first page so opening and pull-to-refresh are quick
const PAGE_SIZE = 40; // then 40 at a time, loaded quietly as the reader nears the end
const LOAD_MORE_AT = 8; // start fetching the next page this many cards before the end
const MAX_CARDS = 600; // about 3 weeks of news in one sitting; keeps memory use low
const REFRESH_AFTER_MS = 5 * 60 * 1000; // reload when the app is reopened after 5 minutes
const SEEN_KEY = 'seen-upto'; // newest story the reader has been shown, for the NEW tags

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
  const listRef = useRef<FlatList<Story>>(null);
  const pendingJump = useRef<string | null>(null);
  const savedKey = filter === 'Saved' ? savedIds.join(',') : '';
  const prefsKey = filter === 'For you' ? [...prefs.products, ...prefs.terms].join('|') : '';
  const searchKey = filter === 'Search' ? searchTerm : '';
  const seenBefore = useRef<string | null>(null); // stories newer than this get a NEW tag
  // each tab remembers its cards and position while the app stays open; cleared on a fresh start
  const tabMemory = useRef(new Map<Filter, { stories: Story[]; index: number }>());
  const shownFilter = useRef<Filter | null>(null);
  const indexRef = useRef(0);
  const storiesRef = useRef<Story[]>([]);
  const firstLoad = useRef(true);
  const loadingMore = useRef(false);
  const noMore = useRef(new Set<Filter>()); // tabs where every story is already loaded

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
        .select(STORY_FIELDS)
        .order('published_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + size - 1);
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
    [filter, savedKey, prefsKey, searchKey], // eslint-disable-line react-hooks/exhaustive-deps
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
    if (err) {
      setError("Couldn't load stories. Check your connection and try again.");
      return;
    }
    let rows = cleanStories(data as Story[]);
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
      if (err || shownFilter.current !== f) return;
      const rows = cleanStories(data as Story[]);
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
    const n = storiesRef.current.length;
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

  // switching tabs: remember where the reader was on the tab they are leaving
  const changeFilter = useCallback(
    (f: Filter) => {
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

  // first open only: after a moment, Android asks "Allow CyberSid to send notifications?"
  useEffect(() => {
    if (!ready || getPrefs().alertsAsked || !alertsAvailable) return;
    const t = setTimeout(() => enableAlerts(), 2500);
    return () => clearTimeout(t);
  }, [ready]);


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
      const { data } = await supabase.from('stories').select(STORY_FIELDS).eq('id', id).maybeSingle();
      const [story] = cleanStories(data ? [data as Story] : []);
      if (story) setStories((cur) => (cur.some((x) => x.id === id) ? cur : [story, ...cur]));
    });
  }, []);


  // jump to the story picked in the brief once the feed is on screen
  useEffect(() => {
    if (view !== 'feed' || !pendingJump.current || pageHeight === 0 || filter !== 'All') return;
    const i = stories.findIndex((s) => s.id === pendingJump.current);
    pendingJump.current = null;
    if (i > 0) setTimeout(() => safeScrollTo(i), 50);
  }, [view, stories, pageHeight, filter]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const i = viewableItems[0]?.index;
    if (i != null && i >= 0) setIndex(i);
  }).current;

  useEffect(() => {
    if (view === 'feed' && stories.length && index >= stories.length - LOAD_MORE_AT) loadMore();
  }, [index, stories.length, view, loadMore]);

  // download the next few pictures while the reader is still on this card, so they appear instantly
  useEffect(() => {
    const next = stories.slice(index + 1, index + 4).map((s) => s.image_url).filter((u): u is string => !!u);
    if (next.length) Image.prefetch(next, 'memory-disk').catch(() => {});
  }, [index, stories]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    toTop();
    setRefreshing(false);
  };

  // stable list props, so only the cards that actually changed are redrawn
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);
  // NEW tags, and a "caught up" note on the first story they had already seen
  const marker = seenBefore.current;
  const firstOld = marker ? stories.findIndex((x) => x.created_at <= marker) : -1;
  const renderItem = useCallback(
    ({ item, index: i }: { item: Story; index: number }) => (
      <ErrorBoundary resetKey={item.id} fallback={() => <BrokenCard height={pageHeight} />}>
      <StoryCard
        story={item}
        height={pageHeight}
        active={index === i}
        saved={savedSet.has(item.id)}
        onToggleSave={toggleSaved}
        isNew={!!marker && item.created_at > marker}
        caughtUp={i === firstOld && i > 0}
      />
      </ErrorBoundary>
    ),
    [pageHeight, index, savedSet, toggleSaved, marker, firstOld],
  );
  const extraData = `${index}|${savedIds.length}|${savedIds[0] ?? ''}|${marker}|${firstOld}`;

  const counter = stories.length ? `${String(index + 1).padStart(2, '0')} / ${String(stories.length).padStart(2, '0')}` : '';

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
    content = <Preferences onDone={() => { setView('feed'); tabMemory.current.delete('For you'); if (prefs.products.length + prefs.terms.length) changeFilter('For you'); }} />;
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
        data={stories}
        keyExtractor={(s) => s.id}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} colors={[C.brand]} progressBackgroundColor={C.surface} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
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
      <View style={styles.feed} onLayout={(e) => setPageHeight(Math.floor(e.nativeEvent.layout.height))}>
        {content}
      </View>
    </SafeAreaView>
  );
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

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Oswald_500Medium, Oswald_700Bold });
  const [timedOut, setTimedOut] = useState(false);
  const C = useTheme();
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000); // never wait more than 3 seconds
    return () => clearTimeout(t);
  }, []);
  const ready = fontsLoaded || !!fontError || timedOut;
  const [fatal, setFatal] = useState<string | null>(null);
  const [run, setRun] = useState(0); // bumping this rebuilds every screen from scratch
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
    </SafeAreaProvider>
  );
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  feed: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 15, textAlign: 'center', lineHeight: 22, color: C.muted },
  retry: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
});
