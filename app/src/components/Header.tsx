import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CATEGORIES, type Category, type Mode } from '../lib/types';
import { useTheme } from '../theme';

type Props = {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  category: Category;
  onCategoryChange: (c: Category) => void;
};

export function Header({ mode, onModeChange, category, onCategoryChange }: Props) {
  const t = useTheme();

  const toggleBtn = (value: Mode, label: string) => {
    const on = mode === value;
    return (
      <Pressable
        onPress={() => onModeChange(value)}
        style={[styles.toggleBtn, on && { backgroundColor: t.invertBg }]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
      >
        <Text style={[styles.toggleText, { color: on ? t.invertText : t.text }]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={{ backgroundColor: t.bg }}>
      <View style={styles.topRow}>
        <Text style={[styles.brand, { color: t.text }]}>CyberShorts</Text>
        <View style={[styles.toggle, { borderColor: t.border }]}>
          {toggleBtn('simple', 'Simple')}
          {toggleBtn('technical', 'Technical')}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {CATEGORIES.map((c) => {
          const on = c === category;
          return (
            <Pressable
              key={c}
              onPress={() => onCategoryChange(c)}
              style={[
                styles.chip,
                { borderColor: on ? t.invertBg : t.border, backgroundColor: on ? t.invertBg : 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, { color: on ? t.invertText : t.text }]}>{c}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
  },
  brand: { fontSize: 20, fontWeight: '800' },
  toggle: { flexDirection: 'row', borderWidth: 1, borderRadius: 999, overflow: 'hidden' },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  toggleText: { fontSize: 13, fontWeight: '600' },
  chips: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '500' },
});
