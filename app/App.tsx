import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Header } from './src/components/Header';
import { StoryCard } from './src/components/StoryCard';
import { configMissing, supabase } from './src/lib/supabase';
import type { Category, Mode, Story } from './src/lib/types';
import { useTheme } from './src/theme';

const PAGE_SIZE = 50;

function Feed() {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('simple');
  const [category, setCategory] = useState<Category>('All');
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageHeight, setPageHeight] = useState(0);

  const load = useCallback(async () => {
    if (configMissing) {
      setError('App settings are missing. Check the .env file in the app folder.');
      return;
    }
    let query = supabase
      .from('stories')
      .select('id,source,url,headline,simple,technical,category,image_url,published_at')
      .order('published_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (category !== 'All') query = query.eq('category', category);

    const { data, error: err } = await query;
    if (err) {
      setError("Couldn't load stories. Check your connection and try again.");
      return;
    }
    setError(null);
    setStories(data ?? []);
  }, [category]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  let content;
  if (loading) {
    content = <ActivityIndicator style={styles.center} color={t.text} />;
  } else if (error) {
    content = (
      <View style={styles.center}>
        <Text style={[styles.message, { color: t.muted }]}>{error}</Text>
        <Pressable onPress={onRefresh} style={[styles.retry, { borderColor: t.border }]}>
          <Text style={{ color: t.text, fontWeight: '600' }}>Try again</Text>
        </Pressable>
      </View>
    );
  } else if (stories.length === 0) {
    content = (
      <View style={styles.center}>
        <Text style={[styles.message, { color: t.muted }]}>No {category === 'All' ? '' : category + ' '}stories yet.</Text>
      </View>
    );
  } else if (pageHeight > 0) {
    content = (
      <FlatList
        data={stories}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <StoryCard story={item} mode={mode} height={pageHeight} />}
        extraData={mode}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text} />}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <Header mode={mode} onModeChange={setMode} category={category} onCategoryChange={setCategory} />
      <View style={styles.feed} onLayout={(e) => setPageHeight(Math.floor(e.nativeEvent.layout.height))}>
        {content}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Feed />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  feed: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retry: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
});
