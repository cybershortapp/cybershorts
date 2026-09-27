import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, useFonts } from '@expo-google-fonts/poppins';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
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

import { BriefScreen } from './src/components/BriefScreen';
import { Header } from './src/components/Header';
import { StoryCard } from './src/components/StoryCard';
import { buildBrief } from './src/lib/brief';
import { useSaved } from './src/lib/saved';
import { configMissing, supabase } from './src/lib/supabase';
import { STORY_FIELDS, type Filter, type Story } from './src/lib/types';
import { C, F } from './src/theme';

const PAGE_SIZE = 60;
const REFRESH_AFTER_MS = 5 * 60 * 1000; // reload when the app is reopened after 5 minutes
const BRIEF_KEY = 'last-brief-day';
const todayKey = () => new Date().toISOString().slice(0, 10);

function Main() {
  const { savedIds, toggleSaved } = useSaved();
  const [view, setView] = useState<'brief' | 'feed'>('brief');
  const [filter, setFilter] = useState<Filter>('All');
  const [all, setAll] = useState<Story[]>([]); // latest stories, used for the brief and the All view
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const lastLoaded = useRef(0);
  const listRef = useRef<FlatList<Story>>(null);
  const pendingJump = useRef<string | null>(null);
  const savedKey = filter === 'Saved' ? savedIds.join(',') : '';

  // brief shows on the first open of each day
  useEffect(() => {
    AsyncStorage.getItem(BRIEF_KEY)
      .then((day) => {
        if (day === todayKey()) setView('feed');
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (configMissing) {
      setError('App settings are missing. Check the .env file in the app folder.');
      return;
    }
    if (filter === 'Saved' && savedIds.length === 0) {
      setError(null);
      setStories([]);
      return;
    }
    let query = supabase.from('stories').select(STORY_FIELDS).order('published_at', { ascending: false }).limit(PAGE_SIZE);
    if (filter === 'Saved') query = query.in('id', savedIds);
    else if (filter === 'Critical') query = query.eq('severity', 'Critical');
    else if (filter !== 'All') query = query.eq('category', filter);

    const { data, error: err } = await query;
    if (err) {
      setError("Couldn't load stories. Check your connection and try again.");
      return;
    }
    const rows = (data as Story[]) ?? [];
    lastLoaded.current = Date.now();
    setError(null);
    setStories(rows);
    if (filter === 'All') setAll(rows);
  }, [filter, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    setIndex(0);
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastLoaded.current > REFRESH_AFTER_MS) load();
    });
    return () => sub.remove();
  }, [load]);

  const brief = useMemo(() => buildBrief(all), [all]);

  const openFeed = (story?: Story) => {
    AsyncStorage.setItem(BRIEF_KEY, todayKey()).catch(() => {});
    pendingJump.current = story?.id ?? null;
    if (filter !== 'All') setFilter('All');
    setView('feed');
  };

  // jump to the story picked in the brief once the feed is on screen
  useEffect(() => {
    if (view !== 'feed' || !pendingJump.current || pageHeight === 0 || filter !== 'All') return;
    const i = stories.findIndex((s) => s.id === pendingJump.current);
    pendingJump.current = null;
    if (i > 0) setTimeout(() => listRef.current?.scrollToIndex({ index: i, animated: false }), 50);
  }, [view, stories, pageHeight, filter]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index);
  }).current;

  // download the next few pictures while the reader is still on this card, so they appear instantly
  useEffect(() => {
    const next = stories.slice(index + 1, index + 4).map((s) => s.image_url).filter((u): u is string => !!u);
    if (next.length) Image.prefetch(next, 'memory-disk').catch(() => {});
  }, [index, stories]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // stable list props, so only the cards that actually changed are redrawn
  const savedSet = useMemo(() => new Set(savedIds), [savedIds]);
  const renderItem = useCallback(
    ({ item, index: i }: { item: Story; index: number }) => (
      <StoryCard story={item} height={pageHeight} active={index === i} saved={savedSet.has(item.id)} onToggleSave={toggleSaved} />
    ),
    [pageHeight, index, savedSet, toggleSaved],
  );
  const extraData = `${index}|${savedIds.length}|${savedIds[0] ?? ''}`;

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
  } else if (view === 'brief') {
    content = <BriefScreen brief={brief} onOpen={openFeed} />;
  } else if (stories.length === 0) {
    content = (
      <View style={styles.center}>
        <Text style={styles.message}>
          {filter === 'Saved' ? 'Tap the bookmark on any story to save it here.' : `No ${filter === 'All' ? '' : filter + ' '}stories yet.`}
        </Text>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} colors={[C.brand]} progressBackgroundColor={C.white} />}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Header view={view} onBrief={() => setView('brief')} filter={filter} onFilterChange={setFilter} counter={counter} />
      <View style={styles.feed} onLayout={(e) => setPageHeight(Math.floor(e.nativeEvent.layout.height))}>
        {content}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  // logo font (Poppins) + chain screen font (Oswald); the app still works with the normal font while they load
  useFonts({ Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Oswald_500Medium, Oswald_700Bold });
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  feed: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 15, textAlign: 'center', lineHeight: 22, color: C.muted },
  retry: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.white },
});
