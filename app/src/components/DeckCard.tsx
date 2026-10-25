import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, View } from 'react-native';

import type { Deck } from '../lib/extras';
import { F } from '../theme';
import { LookDeck, lookOf } from './DeckLooks';

const ACCENTS = ['#FFB86B', '#7DD3FC', '#FF8A80', '#FDE68A', '#4ADE80', '#C9A8FF'];

/** One slide's picture, slowly zooming out while it's on screen (the "Ken Burns" look). */
function SlidePicture({ uri, active }: { uri: string | null; active: boolean }) {
  const zoom = useRef(new Animated.Value(1.15)).current;
  useEffect(() => {
    if (!active) return;
    zoom.setValue(1.15);
    const a = Animated.timing(zoom, { toValue: 1, duration: 9000, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [active, zoom]);
  if (!uri) return <LinearGradient colors={['#2A0F5C', '#0B0718']} style={StyleSheet.absoluteFill} />;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }] }]}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
    </Animated.View>
  );
}

/**
 * A trending deck: a few full-card slides about a group or topic in the news right now.
 * Swipe sideways (or tap Next) through the slides; swipe up to go back to the news.
 */
export function DeckCard(props: { deck: Deck; width: number; height: number; onDone?: () => void }) {
  const look = lookOf(props.deck);
  if (look) return <LookDeck {...props} look={look} />;
  return <ClassicDeck {...props} />;
}

function ClassicDeck({ deck, width, height, onDone }: { deck: Deck; width: number; height: number; onDone?: () => void }) {
  const [i, setI] = useState(0);
  const pager = useRef<ScrollViewInstance>(null);
  const n = deck.slides.length;
  const go = (k: number) => {
    const to = Math.max(0, Math.min(n - 1, k));
    pager.current?.scrollTo({ x: to * width, animated: true });
    setI(to);
  };
  const last = i === n - 1;

  return (
    <View style={{ width, height, borderRadius: 24, overflow: 'hidden', backgroundColor: '#0A0F1F' }}>
      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {deck.slides.map((s, k) => {
          const accent = ACCENTS[k % ACCENTS.length];
          return (
            <View key={k} style={{ width, height }}>
              <SlidePicture uri={s.image} active={k === i} />
              <LinearGradient colors={['rgba(10,15,31,0.65)', 'rgba(10,15,31,0.1)', 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0.95)']} locations={[0, 0.25, 0.55, 1]} style={StyleSheet.absoluteFill} />
              <View style={[styles.body, { bottom: 104 }]}>
                <Text style={[styles.kicker, { color: accent }]}>{s.kicker || (k === 0 ? 'TRENDING NOW' : '')}</Text>
                <Text style={[styles.title, { fontSize: k === 0 ? 40 : 29, lineHeight: k === 0 ? 44 : 34 }]}>{s.title}</Text>
                {!!s.text && <Text style={styles.text}>{s.text}</Text>}
                {s.points.map((p, j) => (
                  <View key={j} style={styles.point}>
                    <View style={[styles.dot, { backgroundColor: accent }]} />
                    <Text style={styles.pointText}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* story-style progress bars and the TRENDING badge */}
      <View style={styles.bars} pointerEvents="none">
        {deck.slides.map((_, k) => (
          <View key={k} style={[styles.bar, { backgroundColor: k <= i ? '#FFFFFF' : 'rgba(255,255,255,0.28)' }]} />
        ))}
      </View>
      <View style={styles.top} pointerEvents="none">
        <View style={styles.badge}>
          <MaterialCommunityIcons name="fire" size={13} color="#FFB86B" />
          <Text style={styles.badgeText}>TRENDING</Text>
        </View>
        <Text style={styles.count}>{i + 1} / {n}</Text>
      </View>

      <View style={styles.buttons}>
        <Pressable onPress={() => go(i - 1)} disabled={i === 0} style={[styles.round, i === 0 && { opacity: 0.35 }]} accessibilityLabel="Previous slide">
          <MaterialCommunityIcons name="chevron-left" size={26} color="#FFFFFF" />
        </Pressable>
        <Pressable onPress={() => (last ? onDone?.() : go(i + 1))} style={styles.next} accessibilityRole="button">
          <Text style={styles.nextText}>{last ? 'Back to the news' : i === 0 ? 'Swipe or tap to start' : 'Next'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { position: 'absolute', left: 22, right: 22, gap: 12 },
  kicker: { fontFamily: F.head, fontSize: 12.5, letterSpacing: 2 },
  title: { color: '#FFFFFF', fontFamily: F.brand, letterSpacing: -0.8 },
  text: { color: 'rgba(255,255,255,0.9)', fontFamily: F.body, fontSize: 16, lineHeight: 24 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
  pointText: { flex: 1, color: '#FFFFFF', fontFamily: F.medium, fontSize: 15, lineHeight: 21 },
  bars: { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', gap: 5 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  top: { position: 'absolute', top: 66, left: 18, right: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { color: '#FFFFFF', fontFamily: F.head, fontSize: 11, letterSpacing: 1.2 },
  count: { color: 'rgba(255,255,255,0.7)', fontFamily: F.medium, fontSize: 12 },
  buttons: { position: 'absolute', left: 18, right: 18, bottom: 26, flexDirection: 'row', gap: 10, alignItems: 'center' },
  round: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  next: { flex: 1, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  nextText: { color: '#0A0F1F', fontFamily: F.head, fontSize: 15 },
});
