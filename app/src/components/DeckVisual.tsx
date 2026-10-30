import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, type HostInstance, PanResponder, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { buzz } from '../lib/buzz';
import type { Deck, DeckSlide } from '../lib/extras';
import { F } from '../theme';
import { Fit } from './Fit';

/**
 * The trending deck as visual "stories" (release 1.0.6): tap or swipe through a few slides about what
 * everyone in security is talking about. Each slide is drawn from its words: a big cover, numbers as
 * tiles, the attack as a chain of steps, a timeline, a tick-off checklist and a one-tap quick check.
 * The attacker and the defender "talk" at the bottom (the server's `say` lines).
 */
const INK = '#15172B';
const PALETTES = [
  { bg: '#E4F3FC', accent: '#0B6BCB', soft: '#CDE7F8' },
  { bg: '#E3F7F2', accent: '#0E8F7E', soft: '#C9EFE5' },
  { bg: '#EFEAFE', accent: '#6A3DF0', soft: '#DED3FD' },
  { bg: '#FFEDE6', accent: '#D9480F', soft: '#FFD8C8' },
];
const paletteOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTES[Math.abs(h) % PALETTES.length];
};
type Pal = (typeof PALETTES)[number];
type Kind = 'cover' | 'what' | 'how' | 'timeline' | 'safe' | 'check';

export function kindOf(s: DeckSlide, k: number): Kind {
  const kick = (s.kicker || '').toUpperCase();
  if (k === 0) return 'cover';
  if (/TAKEAWAY|BOTTOM LINE|REMEMBER/.test(kick)) return 'check';
  if (/SAFE|PROTECT|WHAT TO DO|DEFEN[CS]E|YOUR MOVE/.test(kick) && s.points.length) return 'safe';
  if (/HOW|METHOD|TACTIC|TRICK|TOOL|WORKS/.test(kick) && s.points.length >= 2) return 'how';
  if (/HAPPEN|RECENT|NEWS|CASE|LATEST|TIMELINE/.test(kick) || /^(THIS WEEK|TODAY|YESTERDAY)$/.test((s.when || '').toUpperCase())) return 'timeline';
  return 'what';
}

// ---- numbers as tiles: "$175,000 won at Pwn2Own Berlin", "5 flaws chained together" ----
const WORDS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twelve: '12', hundreds: '100s', thousands: '1000s', millions: 'Millions', billions: 'Billions' };
// a number on its own (not inside a name like "UNC6240"), with its money sign or size word
const NUM = new RegExp(
  String.raw`(^|[^\w])([$£€₹]\s?\d[\d,.]*(?:\s?(?:million|billion|bn|m|k)\b)?|\d[\d,.]*(?:\s?(?:million|billion|thousand)\b)?(?:\s?(?:yen|dollars|euros|pounds|rupees)\b)?%?(?!-)|(?:` + Object.keys(WORDS).join('|') + String.raw`)\b(?!-))`,
  'i',
);
export type Stat = { big: string; small: string; from: string };
export function statsOf(s: DeckSlide): Stat[] {
  const out: Stat[] = [];
  // only the short bullet points become tiles: "Won $175,000 at Pwn2Own Berlin" -> "$175,000" + "won at Pwn2Own Berlin"
  const take = (line: string) => {
    const m = NUM.exec(line);
    if (!m) return;
    const at = m.index + m[1].length;
    let big = m[2].trim().replace(/[,.]+$/, '');
    if (/^(19|20)\d\d$/.test(big)) return; // a year is not a stat
    big = WORDS[big.toLowerCase()] ?? big;
    const rest = (line.slice(0, at) + line.slice(at + m[2].length)).replace(/\s+/g, ' ').trim().replace(/[.]$/, '');
    if (!rest) return;
    const words = rest.replace(/^(over|about|around|nearly|almost|more than|up to)\s+/i, '');
    const small = words[0].toLowerCase() + words.slice(1);
    out.push({ big, small: small.length > 38 ? small.slice(0, 36).trimEnd() + '…' : small, from: line });
  };
  s.points.forEach(take);
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.big) ? false : (seen.add(x.big), true))).slice(0, 3);
}

/** The first points of the "stay safe" slide, for the timeline's last step ("Your move"). */
const firstSafe = (deck: Deck) => deck.slides.find((s, k) => kindOf(s, k) === 'safe')?.points[0];

export function VisualDeck({ deck, width, height, onDone, active = true }: { deck: Deck; width: number; height: number; onDone?: () => void; active?: boolean }) {
  const P = useMemo(() => paletteOf(deck.id), [deck.id]);
  const n = deck.slides.length;
  const [i, setI] = useState(0);
  const iRef = useRef(0);
  iRef.current = i;
  const go = (d: number) => {
    const to = Math.max(0, Math.min(n - 1, iRef.current + d));
    if (to !== iRef.current) buzz.tick();
    setI(to);
  };
  const left = useRef(0);
  const root = useRef<HostInstance>(null);
  // swipe sideways for the next or previous slide; up and down still move the news feed
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
        onPanResponderRelease: (_, g) => {
          if (g.dx < -40) go(1);
          else if (g.dx > 40) go(-1);
        },
      }),
    [n], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // the first time the deck is on screen it slides a little to the left and back, showing there's more
  // to the side (so people swipe sideways here, not up to the next news card)
  const nudge = useRef(new Animated.Value(0)).current;
  const nudged = useRef(false);
  useEffect(() => {
    if (!active || nudged.current) return;
    nudged.current = true;
    const a = Animated.sequence([
      Animated.delay(900),
      Animated.timing(nudge, { toValue: -Math.round(width * 0.16), duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(260),
      Animated.spring(nudge, { toValue: 0, friction: 6, tension: 60, useNativeDriver: true }),
    ]);
    a.start();
    return () => a.stop();
  }, [active, nudge, width]);
  const s = deck.slides[i];
  const kind = kindOf(s, i);
  const last = i === n - 1;
  const stories = deck.story_ids?.length ?? 0;
  const onPic = kind === 'cover' && !!s.image;

  return (
    <View
      ref={root}
      onLayout={() => root.current?.measureInWindow((x: number) => (left.current = x))}
      style={{ width, height, borderRadius: 24, overflow: 'hidden', backgroundColor: P.bg }}
      {...pan.panHandlers}
    >
      {/* shown for a moment behind the slide when it nudges left */}
      <View style={[styles.peek, { width: Math.round(width * 0.2), backgroundColor: P.accent }]}>
        <MaterialCommunityIcons name="chevron-double-left" size={26} color="#FFFFFF" />
      </View>
      <Animated.View style={{ flex: 1, backgroundColor: P.bg, transform: [{ translateX: nudge }] }}>
      {/* tap the left third to go back, anywhere else for the next slide */}
      <Pressable
        style={{ flex: 1 }}
        onPress={(e) => (e.nativeEvent.pageX - left.current < width / 3 ? go(-1) : last ? undefined : go(1))}
        accessibilityRole="button"
        accessibilityLabel={last ? 'Last slide' : 'Next slide'}
      >
        {kind === 'cover' && <Zoom key={`z${i}`} uri={s.image} height={height * (height < 600 ? 0.46 : 0.58)} bg={P.bg} />}
        {kind === 'cover' && !!s.image && (
          // a soft shade at the top, so the progress bars and labels read on any picture
          <LinearGradient colors={['rgba(10,12,30,0.45)', 'rgba(10,12,30,0)']} style={styles.shade} pointerEvents="none" />
        )}
        <View style={[StyleSheet.absoluteFill, { paddingTop: 66 }]}>
          <View style={{ flex: 1 }}>
            <Fit min={0.6}>
              <Slide key={i} deck={deck} s={s} k={i} kind={kind} P={P} height={height} stories={stories} />
            </Fit>
          </View>
          <View style={styles.bottom}>
            {kind !== 'check' && <Talk say={s.say} P={P} k={i} />}
            {last ? (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: kind === 'check' ? 0 : 10 }}>
                <Pressable onPress={onDone} style={[styles.doneBtn, { backgroundColor: P.accent }]} accessibilityRole="button">
                  <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 15 }}>Back to the news</Text>
                </Pressable>
                <Pressable
                  onPress={() => Share.share({ message: `${deck.title}: what everyone in cyber security is talking about today. Shared from CyberSid` }).catch(() => {})}
                  style={styles.shareBtn}
                  accessibilityLabel="Share this trend"
                >
                  <MaterialCommunityIcons name="export-variant" size={20} color={INK} />
                </Pressable>
              </View>
            ) : i === 0 ? (
              <SwipeHint P={P} />
            ) : (
              <Text style={styles.foot}>Swipe or tap for the next slide · {i + 1} of {n}</Text>
            )}
          </View>
        </View>
        <View style={styles.top} pointerEvents="none">
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {deck.slides.map((_, k) => (
              <View key={k} style={[styles.seg, { backgroundColor: onPic ? (k <= i ? '#FFFFFF' : 'rgba(255,255,255,0.4)') : k <= i ? INK : 'rgba(21,23,43,0.15)' }]} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <View style={styles.trend}>
              <MaterialCommunityIcons name="fire" size={13} color="#FF5A1F" />
              <Text style={{ color: INK, fontFamily: F.brand, fontSize: 10.5, letterSpacing: 1 }}>TRENDING</Text>
            </View>
            <Text style={{ flex: 1, color: onPic ? '#FFFFFF' : P.accent, fontFamily: F.brand, fontSize: 10.5, letterSpacing: 1.2, textShadowColor: onPic ? 'rgba(0,0,0,0.4)' : undefined, textShadowRadius: onPic ? 4 : 0 }} numberOfLines={1}>{(s.kicker || deck.topic || '').toUpperCase()}</Text>
            {!!s.when && (
              <View style={[styles.when, { backgroundColor: P.accent }]}>
                <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 10, letterSpacing: 0.8 }} numberOfLines={1}>{s.when.toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
      </Animated.View>
    </View>
  );
}

/** A flashing pill with a moving hand: this card scrolls sideways. */
function SwipeHint({ P }: { P: Pal }) {
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [flash]);
  return (
    <Animated.View style={[styles.hint, { backgroundColor: P.accent, transform: [{ scale: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] }]}>
      <Animated.View style={{ transform: [{ translateX: flash.interpolate({ inputRange: [0, 1], outputRange: [6, -8] }) }] }}>
        <MaterialCommunityIcons name="gesture-swipe-left" size={20} color="#FFFFFF" />
      </Animated.View>
      <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 13.5 }}>Swipe left to read this trend</Text>
      <Animated.View style={{ opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }}>
        <MaterialCommunityIcons name="chevron-double-left" size={18} color="#FFFFFF" />
      </Animated.View>
    </Animated.View>
  );
}

function Slide({ deck, s, k, kind, P, height, stories }: { deck: Deck; s: DeckSlide; k: number; kind: Kind; P: Pal; height: number; stories: number }) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter]);
  const anim = { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] };
  const small = height < 600;
  if (kind === 'cover') {
    // the words sit low, where the picture fades into the colour
    return (
      <Animated.View style={[styles.coverText, anim]}>
        <Text style={[styles.coverTitle, small && { fontSize: 27, lineHeight: 30 }]} numberOfLines={4}>{s.title || deck.title}</Text>
        {!!s.text && <Text style={styles.text} numberOfLines={small ? 3 : 4}>{s.text}</Text>}
        <Text style={styles.meta}>
          {deck.slides.length} slides · 1 minute{stories > 1 ? ` · from ${stories} stories` : ''}
        </Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[styles.body, anim]}>
      {kind === 'what' && <What s={s} P={P} small={small} />}
      {kind === 'how' && <How s={s} P={P} small={small} />}
      {kind === 'timeline' && <Timeline deck={deck} k={k} P={P} small={small} />}
      {kind === 'safe' && <Safe s={s} P={P} small={small} />}
      {kind === 'check' && <Check s={s} P={P} />}
    </Animated.View>
  );
}

/** The cover picture, slowly zooming out, fading into the slide colour. */
function Zoom({ uri, height, bg }: { uri: string | null; height: number; bg: string }) {
  const z = useRef(new Animated.Value(1.12)).current;
  useEffect(() => {
    const a = Animated.timing(z, { toValue: 1, duration: 9000, easing: Easing.out(Easing.quad), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [z]);
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height, overflow: 'hidden' }}>
      {uri ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: z }] }]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        </Animated.View>
      ) : (
        <LinearGradient colors={['#C9DFFF', bg]} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient colors={[bg + '00', bg + '00', bg + 'D9', bg]} locations={[0, 0.42, 0.78, 1]} style={StyleSheet.absoluteFill} />
    </View>
  );
}

function What({ s, P, small }: { s: DeckSlide; P: Pal; small: boolean }) {
  const stats = statsOf(s);
  const used = new Set(stats.map((x) => x.from));
  const rest = s.points.filter((p) => !used.has(p)).slice(0, 3);
  return (
    <View>
      {!!s.image && (
        <View style={[styles.pic, { height: small ? 120 : 168 }]}>
          <Image source={{ uri: s.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        </View>
      )}
      <Text style={[styles.title, { marginTop: s.image ? 14 : 4 }]} numberOfLines={3}>{s.title}</Text>
      {!!s.text && <Text style={styles.text} numberOfLines={small ? 3 : 4}>{s.text}</Text>}
      {stats.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          {stats.map((t, j) => (
            <View key={j} style={styles.stat}>
              <Text style={[styles.statBig, { color: j === 0 ? '#16A34A' : j === 1 ? P.accent : '#E5243B' }]} numberOfLines={1} adjustsFontSizeToFit>{t.big}</Text>
              <Text style={styles.statSmall} numberOfLines={3}>{t.small}</Text>
            </View>
          ))}
        </View>
      )}
      {rest.map((p, j) => (
        <View key={j} style={styles.row}>
          <View style={[styles.rowIcon, { backgroundColor: P.soft }]}>
            <MaterialCommunityIcons name={/researcher|discovered|found by|spotted/i.test(p) ? 'account-search-outline' : 'information-outline'} size={16} color={P.accent} />
          </View>
          <Text style={{ flex: 1, color: INK, fontFamily: F.label, fontSize: 13.5, lineHeight: 18 }}>{p}</Text>
        </View>
      ))}
    </View>
  );
}

function How({ s, P, small }: { s: DeckSlide; P: Pal; small: boolean }) {
  const steps = s.points.slice(0, 5);
  const flow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(flow, { toValue: 1, duration: 1600, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [flow]);
  return (
    <View>
      <Text style={styles.title} numberOfLines={3}>{s.title}</Text>
      {!!s.text && <Text style={styles.text} numberOfLines={small ? 2 : 3}>{s.text}</Text>}
      <View style={{ marginTop: 16, gap: 0 }}>
        {steps.map((p, j) => (
          <View key={j}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={styles.node}>
                <MaterialCommunityIcons name="link-variant" size={18} color={P.accent} />
                <View style={[styles.nodeNum, { backgroundColor: P.accent }]}>
                  <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 10 }}>{j + 1}</Text>
                </View>
              </View>
              <Text style={{ flex: 1, color: INK, fontFamily: F.head, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{p}</Text>
            </View>
            <View style={styles.link}>
              <Animated.View style={{ width: 3, height: 8, borderRadius: 2, backgroundColor: P.accent, transform: [{ translateY: flow.interpolate({ inputRange: [0, 1], outputRange: [-4, 14] }) }] }} />
            </View>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[styles.node, { backgroundColor: '#FFE1E5', borderColor: '#FF9AAB' }]}>
            <MaterialCommunityIcons name="alert-octagon" size={20} color="#E5243B" />
          </View>
          <View style={styles.result}>
            <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 12, letterSpacing: 0.8 }}>{steps.length} SMALL STEPS, ONE BIG ATTACK</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function Timeline({ deck, k, P, small }: { deck: Deck; k: number; P: Pal; small: boolean }) {
  const s = deck.slides[k];
  const events = deck.slides
    .map((x, j) => ({ x, j }))
    .filter(({ x, j }) => j > 0 && j <= k && !!x.when && x.when.toUpperCase() !== 'NOW');
  const move = firstSafe(deck);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [pulse]);
  const list = [...events.map(({ x, j }) => ({ when: x.when, title: x.title, text: j === k ? x.text : '', now: false })), ...(move ? [{ when: 'NOW', title: `Your move: ${move.replace(/\.$/, '')}`, text: '', now: true }] : [])];
  if (!list.length) list.push({ when: s.when || 'NOW', title: s.title, text: s.text, now: true });
  return (
    <View>
      <Text style={styles.title} numberOfLines={3}>{s.title}</Text>
      <View style={{ marginTop: 16 }}>
        {list.map((e, j) => (
          <View key={j} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 22, alignItems: 'center' }}>
              <View style={{ width: 2, height: 12, backgroundColor: j === 0 ? 'transparent' : 'rgba(21,23,43,0.15)' }} />
              <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
                {e.now && (
                  <Animated.View style={{ position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(22,163,74,0.35)', opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }] }} />
                )}
                <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: e.now ? '#16A34A' : j % 2 ? P.accent : '#7C3AED' }} />
              </View>
              <View style={{ flex: 1, width: 2, backgroundColor: j === list.length - 1 ? 'transparent' : 'rgba(21,23,43,0.15)' }} />
            </View>
            <View style={[styles.event, e.now && { borderColor: 'rgba(22,163,74,0.35)' }]}>
              <Text style={{ color: e.now ? '#16A34A' : P.accent, fontFamily: F.brand, fontSize: 10.5, letterSpacing: 1 }}>{(e.when || '').toUpperCase()}</Text>
              <Text style={{ color: INK, fontFamily: F.brand, fontSize: 14.5, lineHeight: 19, marginTop: 2 }} numberOfLines={2}>{e.title}</Text>
              {!!e.text && <Text style={{ color: '#4A4D5A', fontFamily: F.body, fontSize: 12.5, lineHeight: 17, marginTop: 3 }} numberOfLines={small ? 2 : 3}>{e.text}</Text>}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Safe({ s, P, small }: { s: DeckSlide; P: Pal; small: boolean }) {
  const [done, setDone] = useState<number[]>([]);
  const items = s.points.slice(0, 4);
  return (
    <View>
      {!!s.image && !small && (
        <View style={[styles.pic, { height: 130 }]}>
          <Image source={{ uri: s.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: s.image && !small ? 14 : 4 }}>
        <Text style={[styles.title, { flex: 1 }]} numberOfLines={2}>{s.title}</Text>
        <Text style={{ color: done.length === items.length ? '#16A34A' : P.accent, fontFamily: F.brand, fontSize: 12, marginBottom: 4 }}>
          {done.length} of {items.length} done
        </Text>
      </View>
      {!!s.text && <Text style={styles.text} numberOfLines={2}>{s.text}</Text>}
      <View style={{ gap: 8, marginTop: 12 }}>
        {items.map((p, j) => {
          const on = done.includes(j);
          return (
            <Pressable
              key={j}
              onPress={() => {
                if (!on) buzz.right();
                setDone((d) => (on ? d.filter((x) => x !== j) : [...d, j]));
              }}
              style={styles.check}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View style={[styles.box, on && { backgroundColor: '#16A34A', borderColor: '#16A34A' }]}>
                {on && <MaterialCommunityIcons name="check-bold" size={15} color="#FFFFFF" />}
              </View>
              <Text style={{ flex: 1, color: on ? 'rgba(21,23,43,0.45)' : INK, fontFamily: F.head, fontSize: 13.5, lineHeight: 18, textDecorationLine: on ? 'line-through' : 'none' }}>{p}</Text>
            </Pressable>
          );
        })}
      </View>
      {!!items.length && done.length === 0 && <Text style={[styles.foot, { marginTop: 8, textAlign: 'left' }]}>Tick the ones you have done</Text>}
    </View>
  );
}

function Check({ s, P }: { s: DeckSlide; P: Pal }) {
  const [said, setSaid] = useState<boolean | null>(null);
  const pop = useRef(new Animated.Value(1)).current;
  const answer = (v: boolean) => {
    if (said !== null) return;
    setSaid(v);
    (v ? buzz.right : buzz.wrong)();
    pop.setValue(0.9);
    Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  };
  return (
    <View>
      {!!s.image && (
        <View style={[styles.pic, { height: 150 }]}>
          <Image source={{ uri: s.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        </View>
      )}
      <Animated.View style={[styles.quiz, { marginTop: s.image ? 16 : 4, transform: [{ scale: pop }] }]}>
        <Text style={{ color: '#7CF5C4', fontFamily: F.brand, fontSize: 10.5, letterSpacing: 1.2 }}>QUICK CHECK · TRUE OR FALSE?</Text>
        <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 17, lineHeight: 23, marginTop: 6 }}>{s.title}</Text>
        <View style={{ gap: 8, marginTop: 14 }}>
          {[true, false].map((v) => {
            const picked = said === v;
            const right = said !== null && v; // the takeaway is always true
            return (
              <Pressable key={String(v)} onPress={() => answer(v)} style={[styles.tf, right && { backgroundColor: '#16A34A' }, picked && !v && { backgroundColor: '#B42318' }]} accessibilityRole="button">
                <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 14.5 }}>{v ? 'True' : 'False'}</Text>
                {said !== null && v && <MaterialCommunityIcons name="check-bold" size={18} color="#FFFFFF" />}
                {picked && !v && <MaterialCommunityIcons name="close-thick" size={18} color="#FFFFFF" />}
              </Pressable>
            );
          })}
        </View>
        {said !== null && (
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: F.body, fontSize: 13, lineHeight: 18, marginTop: 10 }}>
            {said ? 'Right. ' : 'Not quite: it is true. '}
            {s.text || 'That is the one thing to remember from this trend.'}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

/** The attacker and the defender, in two chat bubbles. */
function Talk({ say, P, k }: { say?: string[]; P: Pal; k: number }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    a.setValue(0);
    b.setValue(0);
    Animated.sequence([
      Animated.delay(150),
      Animated.spring(a, { toValue: 1, friction: 6, useNativeDriver: true }),
      Animated.delay(250),
      Animated.spring(b, { toValue: 1, friction: 6, useNativeDriver: true }),
    ]).start();
  }, [k, a, b]);
  const [bad, good] = [say?.[0], say?.[1]];
  if (!bad && !good) return null;
  const pop = (v: Animated.Value) => ({ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] });
  return (
    <View style={{ gap: 8 }}>
      {!!bad && (
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingRight: 46 }, pop(a)]}>
          <View style={[styles.face, { backgroundColor: INK }]}>
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path d="M12 2c-4 0-7 3-7 7v3l-2 3h18l-2-3V9c0-4-3-7-7-7z" fill="#2A2D45" />
              <Path d="M8.5 10.5h2M13.5 10.5h2" stroke="#7CF5C4" strokeWidth={1.6} strokeLinecap="round" />
            </Svg>
          </View>
          <View style={[styles.bubble, { backgroundColor: INK, borderBottomLeftRadius: 4 }]}>
            <Text style={{ color: '#FFFFFF', fontFamily: F.medium, fontSize: 13, lineHeight: 18 }}>{bad}</Text>
          </View>
        </Animated.View>
      )}
      {!!good && (
        <Animated.View style={[{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 8, paddingLeft: 46 }, pop(b)]}>
          <View style={[styles.bubble, { backgroundColor: '#FFFFFF', borderBottomRightRadius: 4 }]}>
            <Text style={{ color: INK, fontFamily: F.medium, fontSize: 13, lineHeight: 18 }}>{good}</Text>
          </View>
          <View style={[styles.face, { backgroundColor: P.accent }]}>
            <MaterialCommunityIcons name="shield-outline" size={17} color="#FFFFFF" />
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 14, right: 14, top: 12 },
  shade: { position: 'absolute', left: 0, right: 0, top: 0, height: 90 },
  seg: { flex: 1, height: 3, borderRadius: 2 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.9)' },
  when: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  coverText: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 18, paddingBottom: 6 },
  coverTitle: { color: INK, fontFamily: F.brand, fontSize: 32, lineHeight: 35, letterSpacing: -1 },
  meta: { color: 'rgba(21,23,43,0.6)', fontFamily: F.head, fontSize: 12, marginTop: 12 },
  body: { flexGrow: 1, paddingHorizontal: 16 },
  title: { color: INK, fontFamily: F.brand, fontSize: 24, lineHeight: 28, letterSpacing: -0.6 },
  text: { color: '#4A4D5A', fontFamily: F.body, fontSize: 14.5, lineHeight: 21, marginTop: 8 },
  pic: { borderRadius: 24, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.5)', shadowColor: '#1E3C6E', shadowOpacity: 0.14, shadowRadius: 15, shadowOffset: { width: 0, height: 12 }, elevation: 5 },
  stat: { flex: 1, padding: 11, borderRadius: 18, backgroundColor: '#FFFFFF', shadowColor: '#1E3C6E', shadowOpacity: 0.08, shadowRadius: 9, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  statBig: { fontFamily: F.brand, fontSize: 22, letterSpacing: -0.5 },
  statSmall: { color: '#4A4D5A', fontFamily: F.medium, fontSize: 11.5, lineHeight: 15, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.75)' },
  rowIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  node: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: 'rgba(21,23,43,0.08)', alignItems: 'center', justifyContent: 'center' },
  nodeNum: { position: 'absolute', right: -6, top: -6, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  link: { width: 40, height: 16, alignItems: 'center', overflow: 'hidden' },
  result: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#E5243B' },
  event: { flex: 1, marginBottom: 10, padding: 12, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: 'transparent', shadowColor: '#1E3C6E', shadowOpacity: 0.08, shadowRadius: 9, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#FFFFFF', shadowColor: '#1E3C6E', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(21,23,43,0.25)', alignItems: 'center', justifyContent: 'center' },
  quiz: { padding: 16, borderRadius: 22, backgroundColor: INK },
  tf: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 46, paddingHorizontal: 16, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)' },
  bottom: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 8 },
  foot: { color: 'rgba(21,23,43,0.45)', fontFamily: F.medium, fontSize: 11.5, textAlign: 'center', marginTop: 10 },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'center', marginTop: 10, paddingHorizontal: 16, height: 40, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  peek: { position: 'absolute', right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  face: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bubble: { flexShrink: 1, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16 },
  doneBtn: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  shareBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});
