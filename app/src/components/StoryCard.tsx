import { useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '../lib/time';
import type { Mode, Story } from '../lib/types';
import { useCategoryColors, useTheme } from '../theme';

type Props = { story: Story; mode: Mode; height: number };

export function StoryCard({ story, mode, height }: Props) {
  const t = useTheme();
  const [catBg, catText] = useCategoryColors(story.category);
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!story.image_url && !imageFailed;

  return (
    <View style={[styles.page, { height }]}>
      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        <View style={[styles.imageBox, { backgroundColor: catBg }]}>
          {showImage ? (
            <Image
              source={{ uri: story.image_url! }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Text style={[styles.imageFallback, { color: catText }]}>{story.category}</Text>
          )}
        </View>

        <View style={styles.body}>
          <View style={[styles.pill, { backgroundColor: catBg }]}>
            <Text style={[styles.pillText, { color: catText }]}>{story.category}</Text>
          </View>

          <Text style={[styles.headline, { color: t.text }]}>{story.headline}</Text>

          <Text style={[styles.summary, { color: t.muted }]}>
            {mode === 'simple' ? story.simple : story.technical}
          </Text>
        </View>

        <View style={[styles.footer, { borderTopColor: t.border }]}>
          <Text style={[styles.meta, { color: t.faint }]} numberOfLines={1}>
            {story.source} · {timeAgo(story.published_at)}
          </Text>
          <Pressable
            onPress={() => Linking.openURL(story.url)}
            hitSlop={10}
            accessibilityRole="link"
            accessibilityLabel={`Read full story on ${story.source}`}
          >
            <Text style={[styles.link, { color: t.accent }]}>Read full story</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 12, paddingVertical: 8 },
  card: { flex: 1, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  imageBox: { height: '32%', alignItems: 'center', justifyContent: 'center' },
  imageFallback: { fontSize: 22, fontWeight: '600', opacity: 0.8 },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '600' },
  headline: { fontSize: 21, fontWeight: '700', lineHeight: 27, marginTop: 10, marginBottom: 10 },
  summary: { fontSize: 16, lineHeight: 24 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  meta: { fontSize: 13, flexShrink: 1 },
  link: { fontSize: 14, fontWeight: '600' },
});
