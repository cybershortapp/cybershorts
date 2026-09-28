import { useMemo } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { Brief } from '../lib/brief';
import type { Story } from '../lib/types';
import { F, type Palette, severityOf, useTheme } from '../theme';

type Props = { brief: Brief; onOpen: (story?: Story) => void };

const LEVEL_COLOR = ['#12B8FF', '#2563F5', '#EF9F27', '#C62F2E'];
const LEVEL_TEXT = ['#0E86C4', '#1F55D8', '#B45309', '#B42318'];
const LEVEL_TEXT_DARK = ['#5FC8FF', '#7EA0FF', '#F5B75F', '#FF8A80'];

export function BriefScreen({ brief, onOpen }: Props) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;
  const w = Math.min(width - (isTablet ? 48 : 24), 680);
  const s = isTablet ? 1.55 : 1;

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: isTablet ? 'center' : 'flex-start', paddingBottom: 24 }}>
      <View style={{ width: w }}>
        <View style={[styles.panel, { padding: 16 * s }]}>
          <Text style={[styles.label, { fontSize: 12.5 * s }]}>Today's threat level</Text>
          <View style={styles.levelRow}>
            <Text style={{ color: (C.dark ? LEVEL_TEXT_DARK : LEVEL_TEXT)[brief.levelIndex - 1], fontSize: 30 * s, fontFamily: F.brand }}>{brief.level}</Text>
            <Text style={[styles.label, { fontSize: 12.5 * s }]}>
              {brief.critical} critical · {brief.high} high
            </Text>
          </View>
          <View style={styles.bar}>
            {[1, 2, 3, 4].map((n) => (
              <View key={n} style={[styles.seg, { backgroundColor: n <= brief.levelIndex ? LEVEL_COLOR[n - 1] : C.border }]} />
            ))}
          </View>
        </View>

        <Text style={[styles.label, { fontSize: 12.5 * s, marginTop: 18, marginBottom: 8, marginLeft: 2 }]}>Top of the brief</Text>
        {brief.top.map((story, i) => (
          <Pressable
            key={story.id}
            onPress={() => onOpen(story)}
            style={({ pressed }) => [styles.item, { padding: 13 * s, borderColor: pressed ? C.brand : C.border }]}
          >
            <Text style={{ color: severityOf(story.severity, C).accent, fontSize: 15 * s, fontFamily: F.brand }}>
              {String(i + 1).padStart(2, '0')}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 15 * s, lineHeight: 21 * s, fontFamily: F.head }}>{story.headline}</Text>
              {!!story.why_it_matters && (
                <Text style={{ color: C.muted, fontSize: 13 * s, lineHeight: 18 * s, marginTop: 4 }} numberOfLines={2}>
                  {story.why_it_matters}
                </Text>
              )}
            </View>
            {(story.attack_chain?.length ?? 0) >= 3 && (
              <MaterialCommunityIcons name="link-variant" size={18 * s} color={C.brandDark} accessibilityLabel="Has attack chain" />
            )}
          </Pressable>
        ))}

        <Pressable
          onPress={() => onOpen()}
          style={({ pressed }) => [styles.start, { opacity: pressed ? 0.85 : 1, paddingVertical: 14 * s }]}
          accessibilityRole="button"
        >
          <Text style={{ color: C.onBrand, fontSize: 16 * s, fontFamily: F.label }}>
            Start briefing{brief.todayCount ? ` · ${brief.todayCount} today` : ''}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
  label: { color: C.muted },
  panel: { backgroundColor: C.surface, borderColor: C.border, borderWidth: 1, borderRadius: 16, marginTop: 6 },
  levelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 8, borderRadius: 3 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: C.surface, borderWidth: 1, borderRadius: 12, marginBottom: 10 },
  start: { marginTop: 6, backgroundColor: C.brand, borderRadius: 12, alignItems: 'center' },
});
