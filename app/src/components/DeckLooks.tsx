import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { Deck, DeckSlide } from '../lib/extras';
import { F, FS } from '../theme';
import { Fit } from './Fit';

/** The extra trending deck looks. The server picks one per deck; older decks keep the classic look. */
export type DeckLook = 'wanted' | 'case' | 'timeline' | 'comic';
export const DECK_LOOKS: DeckLook[] = ['wanted', 'case', 'timeline', 'comic'];
export const lookOf = (deck: Deck): DeckLook | null => {
  const st = deck.slides[0]?.style as DeckLook | undefined;
  return st && DECK_LOOKS.includes(st) ? st : null;
};

type SlideProps = { s: DeckSlide; k: number; n: number; deck: Deck; width: number };

const CHROME: Record<DeckLook, { bg: string[]; on: string; off: string; btn: string; btnText: string; font: string; size: number }> = {
  wanted: { bg: ['#3A2716', '#2B1D12'], on: '#E9D6AE', off: 'rgba(233,214,174,0.3)', btn: '#E9D6AE', btnText: '#2B1D12', font: FS.wanted, size: 16 },
  case: { bg: ['#3B2F25', '#1E1712'], on: '#C9A86A', off: 'rgba(201,168,106,0.3)', btn: '#C9A86A', btnText: '#1E1712', font: FS.typewriter, size: 16 },
  timeline: { bg: ['#0B1230', '#050816'], on: '#7DD3FC', off: 'rgba(125,211,252,0.25)', btn: '#FFFFFF', btnText: '#0B1230', font: F.head, size: 15 },
  comic: { bg: ['#FFE45C', '#FFD43B'], on: '#111111', off: 'rgba(17,17,17,0.25)', btn: '#111111', btnText: '#FFE45C', font: FS.comic, size: 19 },
};

/** Plays an entrance each time a new slide shows (it is keyed by the slide number). */
function useEntrance(duration = 420) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [v, duration]);
  return v;
}

export function LookDeck({ deck, look, width, height, onDone }: { deck: Deck; look: DeckLook; width: number; height: number; onDone?: () => void }) {
  const n = deck.slides.length;
  const [i, setI] = useState(0);
  const go = (d: number) => setI((c) => Math.max(0, Math.min(n - 1, c + d)));
  // swipe sideways for the next or previous slide; up and down still move the news feed
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        onPanResponderRelease: (_, g) => {
          if (g.dx < -40) setI((c) => Math.min(n - 1, c + 1));
          else if (g.dx > 40) setI((c) => Math.max(0, c - 1));
        },
      }),
    [n],
  );
  const c = CHROME[look];
  const last = i === n - 1;
  const Slide = { wanted: Wanted, case: CaseFile, timeline: Timeline, comic: Comic }[look];
  const label = last ? 'Back to the news' : i === 0 ? (look === 'comic' ? 'READ THE COMIC!' : 'Swipe or tap to start') : look === 'comic' ? 'NEXT PAGE!' : 'Next';

  return (
    <View style={{ width, height, borderRadius: 24, overflow: 'hidden' }} {...pan.panHandlers}>
      <LinearGradient colors={c.bg as [string, string]} style={StyleSheet.absoluteFill} />
      {look === 'comic' && <Dots width={width} height={height} />}
      <View style={styles.bars} pointerEvents="none">
        {deck.slides.map((_, k) => (
          <View key={k} style={[styles.bar, { backgroundColor: k <= i ? c.on : c.off }]} />
        ))}
      </View>
      <View style={{ position: 'absolute', left: 14, right: 14, top: 64, bottom: 90 }}>
        <Fit min={0.75}>
          <Slide key={look === 'timeline' ? 'tl' : i} s={deck.slides[i]} k={i} n={n} deck={deck} width={width - 28} />
        </Fit>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={() => go(-1)} disabled={i === 0} style={[styles.round, { borderColor: c.btn, opacity: i === 0 ? 0.35 : 1 }]} accessibilityLabel="Previous slide">
          <Text style={{ color: look === 'comic' ? '#111111' : c.btn, fontSize: 24, marginTop: -2 }}>‹</Text>
        </Pressable>
        <Pressable onPress={() => (last ? onDone?.() : go(1))} style={[styles.next, { backgroundColor: c.btn }]} accessibilityRole="button">
          <Text style={{ color: c.btnText, fontFamily: c.font, fontSize: c.size, letterSpacing: look === 'comic' ? 1 : 0 }}>{label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Dots({ width, height }: { width: number; height: number }) {
  const dots: ReactNode[] = [];
  for (let y = 6; y < height; y += 14) for (let x = (y / 14) % 2 ? 6 : 13; x < width; x += 14) dots.push(<Circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill="#E8B400" />);
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {dots}
    </Svg>
  );
}

// ------------------------------------------------------------------------------------------------
// Wanted poster: an old western poster, flipping in like a page. A stamp lands on the last one.
// ------------------------------------------------------------------------------------------------
const WANTED_BIG = ['WANTED', 'WHO', 'METHOD', 'LAST SEEN', 'STAY SAFE', 'REWARD'];
function Wanted({ s, k, n }: SlideProps) {
  const a = useEntrance(450);
  const stamp = useRef(new Animated.Value(0)).current;
  const lastOne = k === n - 1;
  useEffect(() => {
    if (lastOne) Animated.spring(stamp, { toValue: 1, friction: 5, delay: 300, useNativeDriver: true }).start();
  }, [lastOne, stamp]);
  const big = k === n - 1 ? 'REWARD' : WANTED_BIG[Math.min(k, 4)];
  return (
    <Animated.View style={[styles.poster, { opacity: a, transform: [{ perspective: 900 }, { rotateY: a.interpolate({ inputRange: [0, 1], outputRange: ['-70deg', '0deg'] }) }] }]}>
      <View style={[styles.nail, { left: 8 }]} />
      <View style={[styles.nail, { right: 8 }]} />
      <Text style={{ fontFamily: FS.wanted, fontSize: 44, lineHeight: 50, color: '#2B1D12', letterSpacing: 2 }} numberOfLines={1} adjustsFontSizeToFit>{big}</Text>
      {!!s.kicker && <Text style={{ fontFamily: FS.serifBold, fontSize: 11.5, letterSpacing: 3, color: '#2B1D12', textAlign: 'center' }}>{s.kicker}</Text>}
      {k === 0 && !!s.image && (
        <View style={{ width: '70%', aspectRatio: 1.35, borderWidth: 4, borderColor: '#2B1D12', overflow: 'hidden', marginTop: 6 }}>
          <Image source={{ uri: s.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(112,66,20,0.45)' }]} />
        </View>
      )}
      <Text style={{ fontFamily: FS.wanted, fontSize: 25, lineHeight: 31, color: '#2B1D12', textAlign: 'center', marginTop: 6 }}>{s.title}</Text>
      <View style={{ height: 2, alignSelf: 'stretch', backgroundColor: '#2B1D12', marginVertical: 6 }} />
      {!!s.text && <Text style={{ fontFamily: FS.serif, fontSize: 14.5, lineHeight: 21, color: '#2B1D12', alignSelf: 'stretch' }}>{s.text}</Text>}
      {s.points.map((p, j) => (
        <View key={j} style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 4 }}>
          <Text style={{ fontFamily: FS.wanted, fontSize: 14, color: '#9B1C1C' }}>★</Text>
          <Text style={{ flex: 1, fontFamily: FS.serif, fontSize: 14.5, lineHeight: 21, color: '#2B1D12' }}>{p}</Text>
        </View>
      ))}
      {lastOne && (
        <Animated.View style={[styles.wantedStamp, { opacity: stamp, transform: [{ rotate: '-12deg' }, { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [2.4, 1] }) }] }]}>
          <Text style={{ fontFamily: FS.wanted, fontSize: 21, color: '#9B1C1C' }}>CASE CLOSED</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ------------------------------------------------------------------------------------------------
// Case file: a detective's folder. Typewriter text, a taped polaroid, red string between the clues.
// ------------------------------------------------------------------------------------------------
const CASE_STAMP = ['TRENDING', 'SUBJECT', 'EVIDENCE', 'ON FILE', 'ADVICE', 'CLOSED'];
function CaseFile({ s, k, n, deck, width }: SlideProps) {
  const a = useEntrance(400);
  const stamp = k === n - 1 ? 'CLOSED' : CASE_STAMP[Math.min(k, 4)];
  const pic = (k === 0 || k === 3) && !!s.image;
  const day = deck.id.slice(0, 4).toUpperCase();
  return (
    <View style={{ flexGrow: 1 }}>
      <View style={styles.folderTab}>
        <Text style={{ fontFamily: FS.typewriter, fontSize: 11.5, color: '#3B2A12' }}>FILE {day} · TRENDING</Text>
      </View>
      <Animated.View style={[styles.casePage, { opacity: a, transform: [{ translateX: a.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }, { rotate: '-1deg' }] }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <Text style={{ flex: 1, fontFamily: FS.typewriter, fontSize: 12, letterSpacing: 2, color: '#7A6A55' }}>{s.kicker}</Text>
          <View style={styles.caseStamp}>
            <Text style={{ fontFamily: F.head, fontSize: 12, letterSpacing: 2, color: '#B42318' }}>{stamp}</Text>
          </View>
        </View>
        <Text style={{ fontFamily: FS.typewriter, fontSize: 25, lineHeight: 31, color: '#1E1712', marginTop: 8 }}>{s.title}</Text>
        {pic && (
          <View style={{ height: 180, marginTop: 10 }}>
            <View style={[styles.polaroid, { width: Math.min(190, width * 0.52) }]}>
              <Image source={{ uri: s.image! }} style={{ width: '100%', height: 124 }} contentFit="cover" cachePolicy="memory-disk" />
              <Text style={{ fontFamily: FS.typewriter, fontSize: 12, color: '#1E1712', textAlign: 'center', marginTop: 5 }}>{k === 0 ? 'Exhibit A' : 'Exhibit B'}</Text>
            </View>
            <View style={styles.tape} />
            <Svg width={140} height={180} viewBox="0 0 140 180" style={{ position: 'absolute', right: 0, top: 0 }}>
              <Path d="M6 40 Q60 70 112 28" fill="none" stroke="#B42318" strokeWidth={2} />
              <Path d="M6 40 Q52 140 120 156" fill="none" stroke="#B42318" strokeWidth={2} />
              <Circle cx={112} cy={28} r={6} fill="#B42318" />
              <Circle cx={120} cy={156} r={6} fill="#B42318" />
            </Svg>
          </View>
        )}
        {!!s.text && <Text style={styles.caseText}>{s.text}</Text>}
        {s.points.map((p, j) => (
          <View key={j} style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <Text style={[styles.caseText, { color: '#B42318', marginTop: 0 }]}>{k === 4 ? '+' : '>'}</Text>
            <Text style={[styles.caseText, { flex: 1, marginTop: 0 }]}>{p}</Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Timeline: a glowing line grows down the card, one event per tap. The last one pulses: "now".
// ------------------------------------------------------------------------------------------------
const TL_COLOURS = ['#7DD3FC', '#A5B4FC', '#C9A8FF', '#F0ABFC', '#FDA4AF', '#4ADE80'];
function Timeline({ deck, k: i }: SlideProps) {
  // one Timeline for the whole deck (it is not re-keyed per slide), so the events stack up as you tap
  const n = deck.slides.length;
  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 6 }}>
      <Text style={{ color: '#7DD3FC', fontFamily: F.head, fontSize: 12, letterSpacing: 2 }}>TRENDING · TIMELINE</Text>
      <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 28, lineHeight: 33, letterSpacing: -0.8, marginTop: 4 }}>{deck.title}</Text>
      <View style={{ marginTop: 16 }}>
        {deck.slides.slice(0, i + 1).map((s, k) => (
          <TimelineEvent key={k} s={s} k={k} current={k === i} last={k === n - 1} colour={TL_COLOURS[k % TL_COLOURS.length]} />
        ))}
      </View>
    </View>
  );
}

function TimelineEvent({ s, k, current, last, colour }: { s: DeckSlide; k: number; current: boolean; last: boolean; colour: string }) {
  const a = useEntrance(380);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!(current && last)) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [current, last, glow]);
  const when = s.when || (k === 0 ? 'START' : last ? 'NOW' : s.kicker);
  return (
    <Animated.View style={{ flexDirection: 'row', gap: 12, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
      <View style={{ width: 20, alignItems: 'center' }}>
        <View style={{ width: 3, height: 6, backgroundColor: k === 0 ? 'transparent' : 'rgba(125,211,252,0.5)' }} />
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colour, borderWidth: 3, borderColor: '#0B1230' }}>
          {current && last && <Animated.View style={{ position: 'absolute', left: -9, top: -9, width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colour, opacity: glow }} />}
        </View>
        <View style={{ flex: 1, width: 3, backgroundColor: current ? 'transparent' : 'rgba(125,211,252,0.5)' }} />
      </View>
      <View style={[{ flex: 1, marginBottom: 10 }, current && styles.tlCard]}>
        <Text style={{ color: colour, fontFamily: F.head, fontSize: 12, letterSpacing: 1.5 }}>{when}</Text>
        <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: current ? 18 : 15, lineHeight: current ? 23 : 20, marginTop: 2 }} numberOfLines={current ? undefined : 1}>{s.title}</Text>
        {current && (
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              {!!s.text && <Text style={styles.tlText}>{s.text}</Text>}
              {s.points.slice(0, 4).map((p, j) => (
                <Text key={j} style={[styles.tlText, { marginTop: 4 }]}>• {p}</Text>
              ))}
            </View>
            {!!s.image && !s.points.length && <Image source={{ uri: s.image }} style={{ width: 64, height: 64, borderRadius: 10 }} contentFit="cover" cachePolicy="memory-disk" />}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ------------------------------------------------------------------------------------------------
// Comic strip: two panels per page, speech bubbles pop in, and a POW word on the big moments.
// ------------------------------------------------------------------------------------------------
const PANEL_BG = [['#FCA5A5', '#BFDBFE'], ['#C4B5FD', '#FECACA'], ['#BBF7D0', '#FDE68A'], ['#FDE68A', '#BBF7D0'], ['#BFDBFE', '#BBF7D0'], ['#BBF7D0', '#BFDBFE']];
function Comic({ s, k, n }: SlideProps) {
  const p1 = useEntrance(420);
  const p2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(p2, { toValue: 1, duration: 420, delay: 300, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [p2]);
  const say1 = s.say?.[0] || s.title;
  const say2 = s.say?.[1] || s.text || s.points.join(' ');
  const pow = k === 0 ? 'BREAKING!' : k === n - 1 ? 'SAFE!' : k === 3 ? 'KABOOM!' : '';
  const bg = PANEL_BG[k % PANEL_BG.length];
  const pop = (v: Animated.Value) => ({ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] });
  return (
    <View style={{ flexGrow: 1, gap: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: FS.comic, fontSize: 28, color: '#111111', letterSpacing: 1 }}>CYBER COMICS</Text>
        <View style={styles.comicTag}>
          <Text style={{ fontFamily: FS.comic, fontSize: 15, color: '#FFFFFF' }}>TRENDING!</Text>
        </View>
      </View>
      <View style={styles.caption}>
        <Text style={{ fontFamily: FS.comic, fontSize: 18, color: '#FFE45C', letterSpacing: 1 }}>{s.kicker || 'MEANWHILE...'}</Text>
      </View>
      <Animated.View style={[styles.panelWrap, pop(p1)]}>
        <View style={styles.panelShadow} />
        <View style={[styles.panel, { backgroundColor: bg[0] }]}>
          <Hacker mood={k % 2} />
          <View style={[styles.bubble, { marginLeft: 112, marginRight: 10 }]}>
            <Text style={styles.bubbleText}>{say1}</Text>
          </View>
        </View>
      </Animated.View>
      <Animated.View style={[styles.panelWrap, pop(p2)]}>
        <View style={styles.panelShadow} />
        <View style={[styles.panel, { backgroundColor: bg[1], paddingBottom: pow ? 60 : 14 }]}>
          <Reader happy={k === n - 1} />
          <View style={[styles.bubble, { marginLeft: 10, marginRight: 112 }]}>
            <Text style={styles.bubbleText}>{say2}</Text>
          </View>
          {!!pow && <Text style={styles.pow}>{pow}</Text>}
        </View>
      </Animated.View>
    </View>
  );
}

function Hacker({ mood }: { mood: number }) {
  return (
    <Svg width={104} height={130} viewBox="0 0 120 150" style={{ position: 'absolute', left: 6, bottom: 0 }}>
      <Path d="M20 150 Q60 96 100 150 Z" fill="#1F2937" stroke="#111" strokeWidth={4} />
      <Circle cx={60} cy={56} r={34} fill="#E5E7EB" stroke="#111" strokeWidth={4} />
      <Path d="M24 60 Q22 10 60 12 Q98 10 96 60 Q86 30 60 30 Q34 30 24 60 Z" fill="#111" />
      <Circle cx={48} cy={60} r={5} fill="#111" />
      <Circle cx={72} cy={60} r={5} fill="#111" />
      <Path d={mood ? 'M44 76 Q60 90 76 76' : 'M46 78 Q60 86 74 78'} fill="none" stroke="#111" strokeWidth={4} strokeLinecap="round" />
      <Rect x={88} y={50} width={16} height={30} rx={4} fill="#333" stroke="#111" strokeWidth={3} />
    </Svg>
  );
}

function Reader({ happy }: { happy: boolean }) {
  return (
    <Svg width={104} height={130} viewBox="0 0 120 150" style={{ position: 'absolute', right: 6, bottom: 0 }}>
      <Path d="M20 150 Q60 100 100 150 Z" fill="#10B981" stroke="#111" strokeWidth={4} />
      <Circle cx={60} cy={56} r={34} fill="#FFD7B5" stroke="#111" strokeWidth={4} />
      <Path d="M26 50 Q32 14 60 18 Q90 14 94 50 Q80 32 60 34 Q40 32 26 50 Z" fill="#7C3AED" />
      <Circle cx={48} cy={60} r={5} fill="#111" />
      <Circle cx={72} cy={60} r={5} fill="#111" />
      <Path d={happy ? 'M44 74 Q60 90 76 74' : 'M48 82 Q60 70 72 82'} fill="none" stroke="#111" strokeWidth={4} strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  bars: { position: 'absolute', top: 52, left: 16, right: 16, flexDirection: 'row', gap: 5 },
  bar: { flex: 1, height: 3, borderRadius: 2 },
  buttons: { position: 'absolute', left: 18, right: 18, bottom: 26, flexDirection: 'row', gap: 10, alignItems: 'center' },
  round: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  next: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  poster: { flexGrow: 1, backgroundColor: '#E9D6AE', borderRadius: 4, borderWidth: 1, borderColor: '#C9AE7E', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, alignItems: 'center', gap: 4 },
  nail: { position: 'absolute', top: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#5B4126' },
  wantedStamp: { marginTop: 12, borderWidth: 4, borderColor: '#9B1C1C', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 4 },
  folderTab: { alignSelf: 'flex-start', marginLeft: 10, backgroundColor: '#C9A86A', borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 12, paddingVertical: 4 },
  casePage: { flexGrow: 1, backgroundColor: '#F3EBDD', borderRadius: 4, padding: 18, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  caseStamp: { borderWidth: 3, borderColor: '#B42318', paddingHorizontal: 8, paddingVertical: 2, transform: [{ rotate: '8deg' }] },
  caseText: { fontFamily: FS.typewriter, fontSize: 15, lineHeight: 22, color: '#1E1712', marginTop: 10 },
  polaroid: { position: 'absolute', left: 4, top: 6, backgroundColor: '#FFFFFF', padding: 8, paddingBottom: 6, transform: [{ rotate: '-5deg' }], shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  tape: { position: 'absolute', left: 70, top: 0, width: 58, height: 18, backgroundColor: 'rgba(255,240,180,0.75)', transform: [{ rotate: '-4deg' }] },
  tlCard: { backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 12 },
  tlText: { color: 'rgba(255,255,255,0.8)', fontFamily: F.body, fontSize: 14, lineHeight: 20 },
  comicTag: { backgroundColor: '#E5372A', borderWidth: 3, borderColor: '#111111', paddingHorizontal: 8, paddingVertical: 1, transform: [{ rotate: '4deg' }] },
  caption: { alignSelf: 'flex-start', backgroundColor: '#111111', paddingHorizontal: 12, paddingVertical: 4, transform: [{ rotate: '-1deg' }] },
  panelWrap: { flexGrow: 1, minHeight: 150 },
  panelShadow: { position: 'absolute', left: 6, top: 6, right: -6, bottom: -6, backgroundColor: '#111111' },
  panel: { flexGrow: 1, minHeight: 150, borderWidth: 4, borderColor: '#111111', overflow: 'hidden', paddingTop: 12, paddingBottom: 14 },
  bubble: { backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: '#111111', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 9 },
  bubbleText: { fontFamily: FS.comicBody, fontSize: 15, lineHeight: 20, color: '#111111' },
  pow: { position: 'absolute', left: 18, bottom: 14, fontFamily: FS.comic, fontSize: 34, color: '#E5372A', textShadowColor: '#111111', textShadowOffset: { width: 3, height: 3 }, textShadowRadius: 0.1, transform: [{ rotate: '-10deg' }] },
});
