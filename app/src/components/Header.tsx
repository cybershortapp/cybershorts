import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { FILTERS, type Filter } from '../lib/types';
import { F, type Palette, tabColour, useTheme } from '../theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

type Props = {
  view: 'feed' | 'prefs';
  onSaved: () => void;
  onPrefs: () => void;
  hasPrefs: boolean;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  counter: string;
  searching: boolean;
  query: string;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onQueryChange: (q: string) => void;
};

const TAB_ICON: Partial<Record<Filter, IconName>> = {
  'For you': 'star-four-points',
  Critical: 'alert-octagon',
  'Zero-day': 'lightning-bolt',
  Saved: 'bookmark',
};

export function Header({ view, onSaved, onPrefs, hasPrefs, filter, onFilterChange, counter, searching, query, onSearchOpen, onSearchClose, onQueryChange }: Props) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;
  const contentWidth = Math.min(width - (isTablet ? 48 : 24), 760);
  const k = isTablet ? 1.3 : 1;

  return (
    <View style={{ width: contentWidth, alignSelf: 'center' }}>
      <View style={styles.topRow}>
        {/* the brand never shrinks, so "CyberSid" is always shown in full */}
        <View style={[styles.row, { flexShrink: 0 }]}>
          <Image source={require('../../assets/logo-mark.png')} style={{ width: 30 * k, height: 30 * k }} resizeMode="contain" accessibilityIgnoresInvertColors />
          <Text style={[styles.brand, { fontSize: 21 * k }]} numberOfLines={1}>
            Cyber<Text style={{ color: C.dark ? '#3FB6FF' : '#149BFF' }}>S</Text>
            <Text style={{ color: C.dark ? '#6F95FF' : '#3A6FFF' }}>i</Text>
            <Text style={{ color: C.dark ? '#9C86FF' : '#6A4DF8' }}>d</Text>
          </Text>
        </View>
        <View style={[styles.row, { flexShrink: 1, justifyContent: 'flex-end' }]}>
          {view === 'feed' && !!counter && (
            <Text style={{ fontSize: 12 * k, color: C.muted }} numberOfLines={1}>
              {counter}
            </Text>
          )}
          <Pressable onPress={searching ? onSearchClose : onSearchOpen} hitSlop={8} style={[styles.iconBtn, searching && styles.iconOn]} accessibilityLabel="Search stories">
            <MaterialCommunityIcons name="magnify" size={17 * k} color={searching ? C.onBrand : C.brandDark} />
          </Pressable>
          {(() => {
            const on = view === 'feed' && filter === 'Saved';
            return (
              <Pressable onPress={onSaved} hitSlop={8} style={[styles.iconBtn, on && styles.iconOn]} accessibilityLabel="Saved stories">
                <MaterialCommunityIcons name={on ? 'bookmark' : 'bookmark-outline'} size={17 * k} color={on ? C.onBrand : C.brandDark} />
              </Pressable>
            );
          })()}
          <Pressable onPress={onPrefs} hitSlop={8} style={[styles.iconBtn, view === 'prefs' && styles.iconOn]} accessibilityLabel="Preferences">
            <MaterialCommunityIcons name="tune-variant" size={17 * k} color={view === 'prefs' ? C.onBrand : C.brandDark} />
          </Pressable>
        </View>
      </View>

      {view === 'feed' && searching && (
        <View style={styles.searchRow}>
          <MaterialCommunityIcons name="magnify" size={18 * k} color={C.muted} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search stories, products, CVEs..."
            placeholderTextColor={C.muted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[styles.searchInput, { fontSize: 15 * k, color: C.text }]}
            accessibilityLabel="Search stories"
          />
          <Pressable onPress={onSearchClose} hitSlop={10} accessibilityRole="button">
            <Text style={{ color: C.brandDark, fontFamily: F.label, fontSize: 14 * k }}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {view === 'feed' && !searching && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const on = f === filter;
            const tint = tabColour(f, C);
            const icon = TAB_ICON[f];
            // selected tab: white text on the deep light-mode colours, dark text on the softer dark-mode colours
            const onText = C.dark ? '#0A0E17' : '#FFFFFF';
            return (
              <Pressable
                key={f}
                onPress={() => onFilterChange(f)}
                style={[styles.chip, on ? { backgroundColor: tint, borderColor: tint } : { borderColor: C.chipBorder, backgroundColor: C.surface }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                {icon ? (
                  <MaterialCommunityIcons name={f === 'For you' && !hasPrefs ? 'star-four-points-outline' : icon} size={13 * k} color={on ? onText : tint} />
                ) : (
                  <View style={[styles.dot, { backgroundColor: on ? onText : tint }]} />
                )}
                <Text style={{ fontSize: 13 * k, color: on ? onText : C.text, fontFamily: on ? F.label : F.medium }}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 2, paddingTop: 8, paddingBottom: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    brand: { fontFamily: F.brand, color: C.text, paddingRight: 2 },
    iconBtn: { borderWidth: 1, borderColor: C.borderSoft, backgroundColor: C.surface, borderRadius: 999, padding: 6 },
    iconOn: { backgroundColor: C.brand, borderColor: C.brand },
    chips: { paddingBottom: 10, gap: 8 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.chipBorder, backgroundColor: C.surface },
    searchInput: { flex: 1, paddingVertical: 8, fontFamily: F.medium },
  });
