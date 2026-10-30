import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { buzz } from '../lib/buzz';
import { BADGES, getProgress, levelOf, rankOf, streakOf } from '../lib/progress';
import { F } from '../theme';

/**
 * The shared pieces of the 30-second games (release 1.0.6): the top bar (timer ring, hearts, rounds, XP),
 * the dark feedback bar, and the win screen. Each game tells the card how it's going through useHud().
 */
export type Finish = { won: boolean; score: number; total: number; xp: number; badge?: string; line?: string };
export type Hud = {
  /** progress through the game: done of total (round dots) */
  step: (done: number, total: number) => void;
  /** a wrong answer: one heart is lost */
  miss: () => void;
  /** the game is over: XP is saved and the win screen shows */
  finish: (f: Finish) => void;
};
const noop: Hud = { step: () => {}, miss: () => {}, finish: () => {} };
export const HudContext = createContext<Hud>(noop);
export const useHud = () => useContext(HudContext);

export const INK = '#15172B';
export const LIVES = 3;
export const GAME_SECONDS = 30;

const HEART = 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z';

/** Timer ring, hearts, round dots and the XP to win. */
export function TopBar({ seconds, lives, done, total, xp, ink, chip, hearts }: { seconds: number | null; lives: number; done: number; total: number; xp: number; ink: string; chip: string; hearts: boolean }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const lost = useRef(new Animated.Value(1)).current;
  const prev = useRef(lives);
  useEffect(() => {
    if (lives < prev.current) {
      lost.setValue(1.5);
      Animated.spring(lost, { toValue: 1, friction: 3, useNativeDriver: true }).start();
    }
    prev.current = lives;
  }, [lives, lost]);
  const dots = Math.min(total, 8);
  return (
    <View style={styles.bar}>
      {seconds != null && (
        <View style={{ width: 38, height: 38 }} accessibilityLabel={`${seconds} seconds left`}>
          <Svg width={38} height={38} viewBox="0 0 38 38">
            <Circle cx={19} cy={19} r={r} fill={chip} stroke={ink === INK ? 'rgba(21,23,43,0.12)' : 'rgba(255,255,255,0.18)'} strokeWidth={3.5} />
            <Circle
              cx={19} cy={19} r={r} fill="none" stroke={seconds <= 5 ? '#FF4D6D' : '#FF8A00'} strokeWidth={3.5} strokeLinecap="round"
              strokeDasharray={`${(c * seconds) / GAME_SECONDS} ${c}`} transform="rotate(-90 19 19)"
            />
          </Svg>
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Text style={{ color: ink, fontFamily: F.brand, fontSize: 13 }}>{seconds}</Text>
          </View>
        </View>
      )}
      {hearts && (
        <Animated.View style={{ flexDirection: 'row', gap: 2, transform: [{ scale: lost }] }} accessibilityLabel={`${lives} of ${LIVES} hearts left`}>
          {Array.from({ length: LIVES }, (_, i) => (
            <Svg key={i} width={17} height={17} viewBox="0 0 24 24">
              <Path d={HEART} fill={i < lives ? '#FF4D6D' : ink === INK ? 'rgba(21,23,43,0.15)' : 'rgba(255,255,255,0.2)'} />
            </Svg>
          ))}
        </Animated.View>
      )}
      {total > 1 && (
        <View style={{ flexDirection: 'row', gap: 4, marginLeft: 6, alignItems: 'center' }}>
          {Array.from({ length: dots }, (_, i) => (
            <View key={i} style={{ width: i === done ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i <= done ? ink : ink === INK ? 'rgba(21,23,43,0.18)' : 'rgba(255,255,255,0.25)' }} />
          ))}
        </View>
      )}
      <View style={[styles.xp, { backgroundColor: chip }]}>
        <MaterialCommunityIcons name="lightning-bolt" size={14} color="#FFB800" />
        <Text style={{ color: ink, fontFamily: F.brand, fontSize: 12 }}>+{xp} XP</Text>
      </View>
    </View>
  );
}

/** The dark bar that says what just happened (right, or why it was wrong). */
export function Feedback({ good, title, text, k }: { good: boolean; title: string; text: string; k: unknown }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.spring(v, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }).start();
  }, [k, v]);
  return (
    <Animated.View style={[styles.feedback, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <View style={[styles.fbIcon, { backgroundColor: good ? '#22C55E' : '#FF4D6D' }]}>
        <MaterialCommunityIcons name={good ? 'check-bold' : 'close-thick'} size={18} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 14.5 }}>{title}</Text>
        {!!text && <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: F.body, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{text}</Text>}
      </View>
    </Animated.View>
  );
}

/** Plays a little "pop in" each time `k` changes. */
export function usePop(k: unknown, from = 0.6) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (k == null) return;
    v.setValue(from);
    Animated.spring(v, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [k, v, from]);
  return v;
}

/** A quick side-to-side shake each time `k` changes (a wrong tap). */
export function useShake(k: unknown) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (k == null) return;
    v.setValue(0);
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(v, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [k, v]);
  return v.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] });
}

/** A gentle up-and-down float, for things that invite a tap. */
export function useFloat(on = true, amount = 6, duration = 1500) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [on, v, duration]);
  return v.interpolate({ inputRange: [0, 1], outputRange: [0, -amount] });
}

// ---- the win screen ----
const CONFETTI = ['#FFD84D', '#FF6B9A', '#7CF5C4', '#8AB4FF', '#FFFFFF', '#FFA24D'];
function Confetti({ width, height }: { width: number; height: number }) {
  const fall = useRef(new Animated.Value(0)).current;
  const bits = useMemo(() => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 40 }, () => ({
      // along the edges and the very top, never over the words
      x: rnd() < 0.5 ? rnd() * 0.12 : 0.86 + rnd() * 0.12,
      y: rnd() * 0.7,
      c: CONFETTI[Math.floor(rnd() * CONFETTI.length)],
      r: Math.round(rnd() * 90),
      w: rnd() < 0.5 ? 8 : 6,
      h: rnd() < 0.5 ? 14 : 10,
      d: 0.6 + rnd() * 0.8,
    }));
  }, []);
  useEffect(() => {
    Animated.timing(fall, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [fall]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {bits.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: b.x * width, top: b.y * height, width: b.w, height: b.h, borderRadius: 2, backgroundColor: b.c, opacity: 0.9,
            transform: [{ translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-160 * b.d, 0] }) }, { rotate: `${b.r}deg` }],
          }}
        />
      ))}
    </View>
  );
}

function Badge({ won }: { won: boolean }) {
  return (
    <Svg width={150} height={150} viewBox="0 0 170 170">
      <Defs>
        <SvgGradient id="bd" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={won ? '#FFE27A' : '#E2E8F0'} />
          <Stop offset="0.5" stopColor={won ? '#FFB13B' : '#CBD5E1'} />
          <Stop offset="1" stopColor={won ? '#FF7A45' : '#94A3B8'} />
        </SvgGradient>
      </Defs>
      <Path d="M85 8l18 12 21-2 9 19 19 9-2 21 12 18-12 18 2 21-19 9-9 19-21-2-18 12-18-12-21 2-9-19-19-9 2-21-12-18 12-18-2-21 19-9 9-19 21 2z" fill="url(#bd)" stroke="#FFFFFF" strokeWidth={4} />
      <Circle cx={85} cy={85} r={44} fill="#FFFFFF" opacity={0.95} />
      <Path d="M85 54l26 10v20c0 16-11 28-26 32-15-4-26-16-26-32V64z" fill={won ? '#6A3DF0' : '#64748B'} />
      {won ? (
        <Path d="M73 85l9 9 17-18" fill="none" stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <Path d="M76 76l18 18M94 76L76 94" fill="none" stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" />
      )}
    </Svg>
  );
}

export type WinInfo = Finish & { name: string; gotXp: number; newBadge: string | null; perfect: boolean; secs: number; bonus?: number };

/** The win (or "good try") moment: what you scored, your XP, streak and level, and where to go next. */
export function WinScreen({ info, width, height, onAgain, onDone, doneLabel }: { info: WinInfo; width: number; height: number; onAgain: () => void; onDone?: () => void; doneLabel?: string }) {
  const p = getProgress();
  const streak = streakOf(p);
  const lvl = levelOf(p.xp);
  const into = p.xp % 250;
  const rank = rankOf(p.xp);
  const pop = usePop(1, 0.5);
  const small = height < 560;
  useEffect(() => {
    (info.won ? buzz.right : buzz.wrong)();
  }, [info.won]);
  const title = !info.won ? (info.score === 0 ? 'Out of hearts' : 'Good try') : info.perfect ? 'Perfect!' : 'Nice work!';
  const sub = info.won ? `Done in ${info.secs} seconds${info.bonus ? ` · speed bonus +${info.bonus} XP` : ''}` : 'Have another go: they are sneaky.';
  const share = () =>
    Share.share({ message: `I just earned the ${BADGES[info.newBadge!]?.name ?? ''} badge on CyberSid by spotting today's cyber tricks. Can you beat it?` }).catch(() => {});
  const tiles = [
    { big: `+${info.gotXp}`, small: 'XP earned' },
    { big: `${streak} 🔥`, small: 'day streak' },
    { big: `Lv ${lvl}`, small: rank.name },
  ];
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: 24, overflow: 'hidden' }]}>
      <LinearGradient
        colors={info.won ? ['#6A3DF0', '#C8459B', '#FF8A4C'] : ['#334155', '#475569', '#64748B']}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {info.won && <Confetti width={width} height={height} />}
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: small ? 18 : 34, paddingBottom: 18, justifyContent: 'space-between' }}>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.winKick}>{info.name.toUpperCase()} · {info.score} OF {info.total}</Text>
          <Animated.Text style={[styles.winTitle, { transform: [{ scale: pop }] }]}>{title}</Animated.Text>
          <Text style={styles.winSub}>{sub}</Text>
        </View>
        <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop }] }}>
          <View style={small ? { transform: [{ scale: 0.75 }], marginVertical: -18 } : undefined}>
            <Badge won={info.won} />
          </View>
          {info.newBadge ? (
            <>
              <Text style={[styles.winKick, { marginTop: 6 }]}>NEW BADGE</Text>
              <Text style={styles.badgeName}>{BADGES[info.newBadge]?.name}</Text>
            </>
          ) : (
            !!info.line && <Text style={[styles.winSub, { marginTop: 8, paddingHorizontal: 6 }]} numberOfLines={3}>{info.line}</Text>
          )}
        </Animated.View>
        <View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {tiles.map((t) => (
              <View key={t.small} style={styles.tile}>
                <Text style={styles.tileBig} numberOfLines={1} adjustsFontSizeToFit>{t.big}</Text>
                <Text style={styles.tileSmall} numberOfLines={1}>{t.small}</Text>
              </View>
            ))}
          </View>
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.levelText}>Level {lvl}</Text>
              <Text style={styles.levelText}>{250 - into} XP to Level {lvl + 1}</Text>
            </View>
            <View style={styles.levelTrack}>
              <LinearGradient colors={['#FFE27A', '#FFB13B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${Math.max(4, (into / 250) * 100)}%`, height: '100%', borderRadius: 5 }} />
            </View>
          </View>
          <View style={{ gap: 10, marginTop: 14 }}>
            {onDone ? (
              <Pressable onPress={onDone} style={styles.winMain} accessibilityRole="button">
                <Text style={styles.winMainText}>{doneLabel ?? 'Back to the news'}</Text>
              </Pressable>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={onAgain} style={[onDone ? styles.winGhost : styles.winMain, { flex: 1 }]} accessibilityRole="button">
                <Text style={onDone ? styles.winGhostText : styles.winMainText}>Play again</Text>
              </Pressable>
              {!!info.newBadge && (
                <Pressable onPress={share} style={[styles.winGhost, { flex: 1 }]} accessibilityRole="button">
                  <Text style={styles.winGhostText}>Share my badge</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  xp: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, backgroundColor: INK },
  fbIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  winKick: { color: 'rgba(255,255,255,0.88)', fontFamily: F.brand, fontSize: 12, letterSpacing: 1.6, textAlign: 'center' },
  winTitle: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 44, letterSpacing: -1.4, marginTop: 6, textAlign: 'center' },
  winSub: { color: 'rgba(255,255,255,0.92)', fontFamily: F.medium, fontSize: 14.5, lineHeight: 20, textAlign: 'center', marginTop: 2 },
  badgeName: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 23, marginTop: 2 },
  tile: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center' },
  tileBig: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 24 },
  tileSmall: { color: 'rgba(255,255,255,0.85)', fontFamily: F.medium, fontSize: 12 },
  levelText: { color: 'rgba(255,255,255,0.92)', fontFamily: F.head, fontSize: 12 },
  levelTrack: { marginTop: 6, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  winMain: { height: 52, borderRadius: 26, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#1E0A50', shadowOpacity: 0.3, shadowRadius: 13, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  winMainText: { color: '#3B1F8F', fontFamily: F.brand, fontSize: 16 },
  winGhost: { height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  winGhostText: { color: '#FFFFFF', fontFamily: F.head, fontSize: 14 },
});
