import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { FILTERS, type Filter } from '../lib/types';
import { C, F } from '../theme';

type Props = {
  view: 'brief' | 'feed';
  onBrief: () => void;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  counter: string;
};

export function Header({ view, onBrief, filter, onFilterChange, counter }: Props) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;
  const contentWidth = Math.min(width - (isTablet ? 48 : 24), 760);
  const k = isTablet ? 1.3 : 1;
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();

  return (
    <View style={{ width: contentWidth, alignSelf: 'center' }}>
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <Image source={require('../../assets/logo-mark.png')} style={{ width: 30 * k, height: 30 * k }} resizeMode="contain" accessibilityIgnoresInvertColors />
          <Text style={[styles.brand, { fontSize: 21 * k }]}>
            Cyber<Text style={{ color: '#149BFF' }}>S</Text><Text style={{ color: '#3A6FFF' }}>i</Text><Text style={{ color: '#6A4DF8' }}>d</Text>
          </Text>
        </View>
        {view === 'feed' ? (
          <View style={styles.brandRow}>
            <Text style={{ fontSize: 12.5 * k, color: C.muted }}>{counter}</Text>
            <Pressable onPress={onBrief} hitSlop={10} style={styles.briefBtn} accessibilityLabel="Open today's brief">
              <MaterialCommunityIcons name="radar" size={15 * k} color={C.brandDark} />
              <Text style={{ fontSize: 12.5 * k, color: C.brandDark, fontFamily: F.label }}>Brief</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={{ fontSize: 12.5 * k, color: C.muted }}>{date}</Text>
        )}
      </View>

      {view === 'feed' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const on = f === filter;
            return (
              <Pressable
                key={f}
                onPress={() => onFilterChange(f)}
                style={[styles.chip, on ? { backgroundColor: C.brand, borderColor: C.brand } : { borderColor: C.chipBorder, backgroundColor: C.white }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                {f === 'Saved' && <MaterialCommunityIcons name="bookmark-outline" size={14 * k} color={on ? C.onBrand : C.text} />}
                <Text style={{ fontSize: 13 * k, color: on ? C.onBrand : C.text, fontFamily: on ? F.label : F.medium }}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 8, paddingBottom: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { borderRadius: 8, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: F.brand, color: C.text, letterSpacing: -0.3 },
  briefBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.borderSoft, backgroundColor: C.white, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chips: { paddingBottom: 10, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
});
