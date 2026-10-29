import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { buzz } from '../lib/buzz';
import type { Game } from '../lib/extras';
import { F } from '../theme';
import { Feedback, INK, useFloat, useHud, usePop, useShake } from './GameKit';

/**
 * The visual 30-second games (release 1.0.6). Same data and rules as before, drawn as real things:
 * a phone lock screen, browser windows, an email, a toy house, a vault. The words come from the server.
 */
type Props = { game: Game; active: boolean; image?: string | null };
type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const MONO = 'JetBrainsMono_400Regular';
const MONO_BOLD = 'JetBrainsMono_700Bold';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LINKISH = /(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/[^\s]*)?/;

/** A message with any web address in it shown as a blue link, like on a phone. */
function WithLink({ text, style }: { text: string; style: object }) {
  const m = LINKISH.exec(text);
  if (!m || !/[a-z]/i.test(m[0].split('.').pop() ?? '')) return <Text style={style}>{text}</Text>;
  const at = m.index;
  return (
    <Text style={style}>
      {text.slice(0, at)}
      <Text style={{ color: '#2F6BF0', textDecorationLine: 'underline' }}>{m[0]}</Text>
      {text.slice(at + m[0].length)}
    </Text>
  );
}

// ------------------------------------------------------------------------------------------------
// 1. Scam or legit: a message lands on a phone's lock screen. Swipe it left (scam) or right (legit).
// ------------------------------------------------------------------------------------------------
export function ScamSwipe({ game }: Props) {
  const hud = useHud();
  const items: { from: string; msg: string; scam: boolean; why: string }[] = (game.data.items ?? []).filter((x: { msg?: string }) => !!x?.msg);
  const n = items.length;
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [said, setSaid] = useState<{ good: boolean; why: string; k: number } | null>(null);
  const [w, setW] = useState(0);
  const pan = useRef(new Animated.ValueXY()).current;
  const busy = useRef(false);
  const state = useRef({ i: 0, score: 0, misses: 0 });
  state.current = { i, score, misses };
  const now = new Date();
  const clock = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const date = `${DAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  useEffect(() => hud.step(0, n), []); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (saidScam: boolean) => {
    const { i: k, score: s, misses: m } = state.current;
    const item = items[k];
    if (!item) return;
    const right = saidScam === item.scam;
    if (right) buzz.right();
    else {
      buzz.wrong();
      hud.miss();
    }
    setSaid({ good: right, why: item.why, k });
    setScore(s + (right ? 1 : 0));
    setMisses(m + (right ? 0 : 1));
    setI(k + 1);
    hud.step(k + 1, n);
    pan.setValue({ x: 0, y: 0 });
    busy.current = false;
    if (k + 1 >= n) {
      const got = s + (right ? 1 : 0);
      setTimeout(() => hud.finish({ won: got >= n - 1, score: got, total: n, xp: got * 40, badge: got === n ? 'scam_or_legit' : undefined, line: 'Real companies never send you links to "check" or "claim" anything. Open their app yourself.' }), 1400);
    }
  };
  const fly = (saidScam: boolean, dy = 0) => {
    if (busy.current || state.current.i >= n) return;
    busy.current = true;
    Animated.timing(pan, { toValue: { x: saidScam ? -480 : 480, y: dy }, duration: 220, useNativeDriver: false }).start(() => answer(saidScam));
  };
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -80 || g.dx > 80) fly(g.dx < 0, g.dy);
          else Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 5, useNativeDriver: false }).start();
        },
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!n) return null;
  const rotate = pan.x.interpolate({ inputRange: [-220, 0, 220], outputRange: ['-14deg', '-2deg', '12deg'] });
  const scamStamp = pan.x.interpolate({ inputRange: [-110, -30, 0], outputRange: [1, 0, 0], extrapolate: 'clamp' });
  const legitStamp = pan.x.interpolate({ inputRange: [0, 30, 110], outputRange: [0, 0, 1], extrapolate: 'clamp' });
  const cardW = Math.min(w - 40, 330);

  const card = (item: (typeof items)[number], top: boolean) => (
    <View style={styles.noteCard}>
      <LinearGradient colors={['#1F2440', '#3B2F6E']} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={styles.lock}>
        <Text style={styles.lockTime}>{clock}</Text>
        <Text style={styles.lockDate}>{date}</Text>
      </LinearGradient>
      <View style={styles.note}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.appIcon}>
            <MaterialCommunityIcons name="message-processing" size={14} color="#FFFFFF" />
          </View>
          <Text style={{ flex: 1, color: INK, fontFamily: F.head, fontSize: 12.5 }} numberOfLines={1}>{item.from}</Text>
          <Text style={{ color: '#6B6F82', fontFamily: F.body, fontSize: 12 }}>now</Text>
        </View>
        <WithLink text={item.msg} style={{ marginTop: 6, color: INK, fontFamily: F.body, fontSize: 14, lineHeight: 19.5 }} />
      </View>
      <View style={{ height: 16 }} />
      {top && (
        <>
          <Animated.View style={[styles.stamp, { right: 14, borderColor: '#E5243B', opacity: scamStamp, transform: [{ rotate: '14deg' }] }]}>
            <Text style={[styles.stampText, { color: '#E5243B' }]}>SCAM</Text>
          </Animated.View>
          <Animated.View style={[styles.stamp, { left: 14, borderColor: '#16A34A', opacity: legitStamp, transform: [{ rotate: '-14deg' }] }]}>
            <Text style={[styles.stampText, { color: '#16A34A' }]}>LEGIT</Text>
          </Animated.View>
        </>
      )}
    </View>
  );

  return (
    <View style={{ flexGrow: 1 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={{ height: 286, marginTop: 4 }}>
        {w > 0 &&
          [2, 1].map((d) =>
            items[i + d] ? (
              <View key={i + d} style={[styles.stackCard, { width: cardW, left: (w - cardW) / 2, opacity: d === 2 ? 0.55 : 0.85, transform: [{ translateY: d * 10 }, { translateX: d === 2 ? 8 : -4 }, { rotate: d === 2 ? '4deg' : '-2deg' }] }]}>
                {card(items[i + d], false)}
              </View>
            ) : null,
          )}
        {w > 0 && i < n && (
          <Animated.View
            key={i}
            {...responder.panHandlers}
            style={[styles.stackCard, { width: cardW, left: (w - cardW) / 2, zIndex: 3, transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}
          >
            {card(items[i], true)}
          </Animated.View>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 46, marginTop: 6 }}>
        {[true, false].map((scam) => (
          <View key={String(scam)} style={{ alignItems: 'center' }}>
            <Pressable
              onPress={() => fly(scam)}
              disabled={i >= n}
              style={[styles.bigBtn, { shadowColor: scam ? '#E5243B' : '#16A34A', borderColor: scam ? 'rgba(229,36,59,0.18)' : 'rgba(22,163,74,0.16)' }]}
              accessibilityRole="button"
              accessibilityLabel={scam ? "It's a scam" : "It's legit"}
            >
              <MaterialCommunityIcons name={scam ? 'close-thick' : 'check-bold'} size={32} color={scam ? '#E5243B' : '#16A34A'} />
            </Pressable>
            <Text style={{ marginTop: 7, color: scam ? '#E5243B' : '#16A34A', fontFamily: F.brand, fontSize: 13 }}>{scam ? 'SCAM' : 'LEGIT'}</Text>
          </View>
        ))}
      </View>
      <View style={{ marginTop: 12, minHeight: 72 }}>
        {said ? (
          <Feedback k={said.k} good={said.good} title={said.good ? 'Nice one!' : 'Gotcha. You lost a heart.'} text={said.why} />
        ) : (
          <Text style={styles.hint}>Swipe the message left for scam, right for legit</Text>
        )}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 2. Which link is real? Three browser windows; a magnifier shows the trick in the fake ones.
// ------------------------------------------------------------------------------------------------
/** The question the server wrote ("A job offer from BuCor? Which link is really Facebook?") without the lead-in. */
/** Split text into sentences, keeping their full stops and question marks. */
export function sentences(text: string): string[] {
  return ((text || '').match(/[^.?!]+[.?!]+["')\]]*|[^.?!]+$/g) ?? []).map((x) => x.trim()).filter(Boolean);
}
export function linkTitle(ask: string) {
  const parts = sentences(ask);
  const q = [...parts].reverse().find((x) => x.endsWith('?'));
  return q || parts[parts.length - 1] || 'Which link is real?';
}
function lensCaption(odd: string) {
  if (/^\d+$/.test(odd)) return 'NUMBERS, NOT LETTERS';
  if (odd.startsWith('.')) return 'WRONG ENDING';
  if (odd.startsWith('-') || odd.endsWith('-')) return 'EXTRA WORDS ADDED';
  return 'SPOT THE TRICK';
}
export function LinkCheck({ game }: Props) {
  const hud = useHud();
  const d: { ask: string; options: { url: string; odd: string; why: string }[]; answer: number } = game.data;
  const opts = (d?.options ?? []).filter((o) => !!o?.url);
  const [wrong, setWrong] = useState<number[]>([]);
  const [won, setWon] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  useEffect(() => hud.step(0, 1), []); // eslint-disable-line react-hooks/exhaustive-deps
  const shake = useShake(wrong.length || null);
  if (opts.length < 2) return null;
  const pick = (k: number) => {
    if (won || wrong.includes(k)) return;
    setLast(k);
    if (k === d.answer) {
      setWon(true);
      buzz.right();
      hud.step(1, 1);
      const m = wrong.length;
      setTimeout(() => hud.finish({ won: true, score: 1, total: 1, xp: m ? Math.max(40, 100 - m * 30) : 100, badge: m === 0 ? 'real_link' : undefined, line: 'Read the address slowly, right to left from the first single slash.' }), 1500);
    } else {
      setWrong((w) => [...w, k]);
      buzz.wrong();
      hud.miss();
    }
  };
  const lensOn = last != null && last !== d.answer && !!opts[last]?.odd;
  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 4 }}>
      <View style={{ gap: 14, marginTop: 6 }}>
        {opts.map((o, k) => {
          const isWrong = wrong.includes(k);
          const isRight = won && k === d.answer;
          const at = o.odd ? o.url.indexOf(o.odd) : -1;
          const show = isWrong && at >= 0;
          return (
            <Animated.View key={k} style={k === last && isWrong ? { transform: [{ translateX: shake }] } : undefined}>
              <Pressable
                onPress={() => pick(k)}
                style={[styles.browser, isWrong && { borderColor: '#E5243B', borderWidth: 2.5 }, isRight && { borderColor: '#16A34A', borderWidth: 2.5 }]}
                accessibilityRole="button"
                accessibilityLabel={`Link ${k + 1}: ${o.url}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {['#FF6159', '#FFBD2E', '#28C840'].map((c) => <View key={c} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />)}
                  <View style={styles.urlBar}>
                    <MaterialCommunityIcons name="lock" size={12} color={isRight ? '#16A34A' : '#8A8D98'} />
                    <Text style={{ flex: 1, fontFamily: MONO, fontSize: 13, color: INK }} numberOfLines={1}>
                      {show ? (
                        <>
                          {o.url.slice(0, at)}
                          <Text style={{ color: '#E5243B', backgroundColor: '#FFE1E5', fontFamily: MONO_BOLD }}>{o.odd}</Text>
                          {o.url.slice(at + o.odd.length)}
                        </>
                      ) : (
                        o.url
                      )}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <LinearGradient colors={['#DCE6FF', '#EFE6FF']} style={{ width: 50, height: 36, borderRadius: 8 }} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={[styles.skel, { width: '70%', backgroundColor: '#E8EAF1' }]} />
                    <View style={[styles.skel, { width: '92%' }]} />
                    <View style={[styles.skel, { width: '55%' }]} />
                  </View>
                </View>
                {(isWrong || isRight) && (
                  <View style={[styles.tag, { backgroundColor: isRight ? '#16A34A' : '#E5243B' }]}>
                    <Text style={styles.tagText}>{isRight ? 'REAL ONE' : 'FAKE'}</Text>
                  </View>
                )}
              </Pressable>
              {lensOn && k === last && <Lens url={o.url} odd={o.odd} />}
            </Animated.View>
          );
        })}
      </View>
      <View style={{ marginTop: 16, minHeight: 72 }}>
        {last == null ? (
          <Text style={styles.hint}>Tap the one you would trust</Text>
        ) : (
          <Feedback k={last} good={last === d.answer} title={last === d.answer ? 'Eagle eyes. That is the real one.' : 'So close! You lost a heart.'} text={opts[last]?.why ?? ''} />
        )}
      </View>
    </View>
  );
}

function Lens({ url, odd }: { url: string; odd: string }) {
  const pop = usePop(url, 0.4);
  const at = url.indexOf(odd);
  // a few letters either side of the trick, big enough to read
  const before = url.slice(Math.max(0, at - Math.max(1, 5 - odd.length)), at);
  const after = url.slice(at + odd.length, at + odd.length + 2);
  return (
    <Animated.View pointerEvents="none" style={[styles.lensWrap, { transform: [{ scale: pop }] }]}>
      <View style={styles.lensHandle} />
      <View style={styles.lens}>
        <Text style={{ fontFamily: MONO_BOLD, fontSize: odd.length > 4 ? 14 : 18, color: INK }} numberOfLines={1} adjustsFontSizeToFit>
          {before}
          <Text style={{ color: '#E5243B', backgroundColor: '#FFE1E5' }}>{odd}</Text>
          {after}
        </Text>
        <Text style={{ marginTop: 5, fontFamily: F.brand, fontSize: 9.5, color: '#E5243B', textAlign: 'center' }}>{lensCaption(odd)}</Text>
      </View>
    </Animated.View>
  );
}

// ------------------------------------------------------------------------------------------------
// 3. Spot the red flags: a real-looking email. Tap the lines that give it away.
// ------------------------------------------------------------------------------------------------
export function FlagMail({ game }: Props) {
  const hud = useHud();
  const lines: { text: string; flag: boolean; why: string }[] = (game.data.lines ?? []).filter((l: { text?: string }) => !!l?.text);
  const total = lines.filter((l) => l.flag).length;
  const [found, setFound] = useState<number[]>([]);
  const [misses, setMisses] = useState(0);
  const [tip, setTip] = useState<{ good: boolean; text: string; k: number } | null>(null);
  const [bad, setBad] = useState<{ k: number; n: number } | null>(null);
  const shake = useShake(bad ? `${bad.k}-${bad.n}` : null);
  const float = useFloat(!tip, 5, 900);
  useEffect(() => hud.step(0, total), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!total) return null;
  const from = lines.find((l) => /^from:/i.test(l.text))?.text ?? '';
  const sender = (from.replace(/^from:\s*/i, '').split('<')[0] || 'Unknown sender').trim();
  const initials = sender.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const tap = (k: number) => {
    const l = lines[k];
    if (found.includes(k)) return;
    if (l.flag) {
      const next = [...found, k];
      setFound(next);
      buzz.right();
      hud.step(next.length, total);
      setTip({ good: true, text: `${next.length === total ? 'All found!' : `Nice, ${next.length} of ${total}.`} ${l.why}`, k });
      if (next.length === total) {
        setTimeout(() => hud.finish({ won: true, score: total, total, xp: Math.max(40, 120 - misses * 20), badge: misses === 0 ? 'red_flags' : undefined, line: 'Any one of these is enough reason to stop and check another way.' }), 1500);
      }
    } else {
      buzz.wrong();
      hud.miss();
      setMisses((m) => m + 1);
      setBad((b) => ({ k, n: (b?.n ?? 0) + 1 }));
      setTip({ good: false, text: 'That part is normal. You lost a heart. Look again.', k: -k - 1 });
    }
  };
  return (
    <View style={{ flexGrow: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 4, marginBottom: 8 }}>
        {Array.from({ length: total }, (_, k) => (
          <View key={k} style={[styles.flagBox, k < found.length && { backgroundColor: '#E5243B' }]}>
            <MaterialCommunityIcons name="flag-variant" size={13} color={k < found.length ? '#FFFFFF' : 'rgba(21,23,43,0.3)'} />
          </View>
        ))}
      </View>
      <View style={styles.mail}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <MaterialCommunityIcons name="chevron-left" size={18} color="#6B6F82" />
          <Text style={{ color: '#6B6F82', fontFamily: F.medium, fontSize: 13 }}>Inbox</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 4 }}>
          <LinearGradient colors={['#7AA2FF', '#9D7BFF']} style={styles.avatar}>
            <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 14 }}>{initials}</Text>
          </LinearGradient>
          <Text style={{ flex: 1, color: INK, fontFamily: F.brand, fontSize: 15 }} numberOfLines={1}>{sender}</Text>
        </View>
        {lines.map((l, k) => {
          const hit = found.includes(k);
          const button = /^\[.*\]$/.test(l.text.trim());
          const isFrom = /^from:/i.test(l.text);
          const isSubject = /^subject:/i.test(l.text);
          return (
            <Animated.View key={k} style={bad?.k === k ? { transform: [{ translateX: shake }] } : undefined}>
              <Pressable onPress={() => tap(k)} style={[button ? styles.mailBtn : styles.mailLine, hit && styles.mailHit]} accessibilityRole="button">
                <Text
                  style={
                    button
                      ? { color: '#FFFFFF', fontFamily: F.brand, fontSize: 14, textAlign: 'center' }
                      : { color: INK, fontFamily: isSubject ? F.head : F.body, fontSize: isFrom ? 12.5 : 14, lineHeight: isFrom ? 17 : 19 }
                  }
                >
                  {button ? l.text.trim().slice(1, -1) : l.text}
                </Text>
                {hit && <FlagPin />}
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
      <View style={{ marginTop: 12, minHeight: 64 }}>
        {tip ? (
          <View style={styles.tipCard}>
            <View style={[styles.tipIcon, { backgroundColor: tip.good ? '#FFE1E5' : '#EEF0F5' }]}>
              <MaterialCommunityIcons name={tip.good ? 'flag-variant' : 'eye-outline'} size={15} color={tip.good ? '#E5243B' : '#6B6F82'} />
            </View>
            <Text style={{ flex: 1, color: INK, fontFamily: F.body, fontSize: 13, lineHeight: 18 }}>{tip.text}</Text>
          </View>
        ) : (
          <Animated.View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, transform: [{ translateY: float }] }}>
            <MaterialCommunityIcons name="gesture-tap" size={22} color={INK} />
            <Text style={[styles.hint, { marginTop: 0 }]}>Tap the lines that look wrong</Text>
          </Animated.View>
        )}
      </View>
    </View>
  );
}
function FlagPin() {
  const pop = usePop(1, 0.3);
  return (
    <Animated.View style={[styles.pin, { transform: [{ scale: pop }] }]}>
      <MaterialCommunityIcons name="flag-variant" size={13} color="#FFFFFF" />
    </Animated.View>
  );
}

// ------------------------------------------------------------------------------------------------
// 4. Lock up your digital home: a burglar tries each way in. Pick the lock that stops him.
// ------------------------------------------------------------------------------------------------
// where each thing sits on the house picture (in the picture's own 640 x 640 pixels)
const SPOTS: Record<string, { name: string; icon: IconName; x: number; y: number }> = {
  router: { name: 'Wi-Fi router', icon: 'router-wireless', x: 350, y: 112 },
  email: { name: 'Email', icon: 'email-outline', x: 178, y: 268 },
  social: { name: 'Social media', icon: 'account-group-outline', x: 410, y: 245 },
  phone: { name: 'Phone', icon: 'cellphone', x: 125, y: 462 },
  bank: { name: 'Bank', icon: 'piggy-bank-outline', x: 492, y: 360 },
};
const LOCKS: { icon: IconName; name: string; sub: string }[] = [
  { icon: 'key-variant', name: 'Unique passwords', sub: 'one per account' },
  { icon: 'cellphone-key', name: '2-step sign-in', sub: 'a code on your phone' },
  { icon: 'update', name: 'Auto updates', sub: 'fixes old bugs' },
  { icon: 'router-wireless-settings', name: 'New router password', sub: 'not the sticker one' },
];
const FIX: Record<string, number> = { reused: 0, stolen: 1, old_bug: 2, default: 3 };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HOUSE = require('../../assets/games/house.jpg');

export function HouseLock({ game }: Props) {
  const hud = useHud();
  const rounds: { spot: string; kind: string; say: string; fail: string }[] = (game.data?.rounds ?? []).filter((x: { spot: string; kind: string; say?: string }) => SPOTS[x?.spot] && x.kind in FIX && x.say);
  const n = rounds.length;
  const [r, setR] = useState(0);
  const [res, setRes] = useState<('locked' | 'broken' | null)[]>(() => rounds.map(() => null));
  const [wrong, setWrong] = useState<{ j: number; n: number } | null>(null);
  const [w, setW] = useState(0);
  const shake = useShake(wrong ? `${wrong.j}-${wrong.n}` : null);
  const ring = useRef(new Animated.Value(0)).current;
  const bob = useFloat(true, 4, 1200);
  useEffect(() => hud.step(0, n), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const a = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [ring]);
  if (n < 3) return null;
  const round = rounds[Math.min(r, n - 1)];
  const now = res[r] ?? null;
  const locked = res.filter((x) => x === 'locked').length;
  const next = (after: ('locked' | 'broken' | null)[]) => {
    setTimeout(() => {
      if (r + 1 >= n) {
        const got = after.filter((x) => x === 'locked').length;
        hud.finish({ won: got >= Math.ceil(n * 0.6), score: got, total: n, xp: got * 30 + (got === n ? 30 : 0), badge: got === n ? 'home' : undefined, line: 'Do the same at home: these four locks take about 20 minutes.' });
      } else {
        setR(r + 1);
        setWrong(null);
        hud.step(r + 1, n);
      }
    }, 1700);
  };
  const pick = (j: number) => {
    if (now !== null) return;
    if (j === FIX[round.kind]) {
      const after = res.map((x, k) => (k === r ? ('locked' as const) : x));
      setRes(after);
      buzz.right();
      next(after);
    } else {
      buzz.wrong();
      hud.miss();
      setWrong((x) => ({ j, n: (x?.n ?? 0) + 1 }));
    }
  };
  const boxW = w;
  const boxH = Math.round(Math.min(270, w * 0.7));
  // the picture fills the box (cover): work out where a point on the picture lands
  const k = Math.max(boxW / 640, boxH / 640);
  const ox = (boxW - 640 * k) / 2;
  const oy = (boxH - 640 * k) / 2;
  const stateOf = (id: string) => {
    const j = rounds.findIndex((x, i) => x.spot === id && (res[i] !== null || i === r));
    return j < 0 ? null : res[j] ?? (j === r ? 'live' : null);
  };
  const bubble = now === 'locked' ? "Locked! He can't get in that way." : wrong ? "That lock won't stop this one. Try another!" : `"${round.say}"`;
  return (
    <View style={{ flexGrow: 1 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <View style={[styles.house, { height: boxH }]}>
          <Image source={HOUSE} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="A toy house with a router, phone and piggy bank" />
          {Object.entries(SPOTS).map(([id, s]) => {
            const st = stateOf(id);
            const live = st === 'live' && now === null;
            const x = ox + s.x * k;
            const y = oy + s.y * k;
            return (
              <View key={id} style={{ position: 'absolute', left: x - 17, top: y - 17, width: 34, height: 34 }}>
                {live && (
                  <Animated.View style={[styles.pinRing, { opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }] }]} />
                )}
                <View style={[styles.housePin, { backgroundColor: st === 'locked' ? '#16A34A' : live ? '#FF4D6D' : '#FFFFFF' }]}>
                  <MaterialCommunityIcons name={st === 'locked' ? 'lock' : s.icon} size={16} color={st === 'locked' || live ? '#FFFFFF' : '#6A3DF0'} />
                </View>
              </View>
            );
          })}
          <View style={styles.lockedChip}>
            <Text style={{ color: '#6A3DF0', fontFamily: F.brand, fontSize: 11.5 }}>{locked} of {n} locked</Text>
          </View>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'flex-start' }}>
        <Animated.View style={{ transform: [{ translateY: bob }] }}>
          <LinearGradient colors={['#2B2350', '#4A3A8A']} style={styles.burglar}>
            <Svg width={30} height={30} viewBox="0 0 24 24">
              <Path d="M12 2c-4 0-7 3-7 7v3l-2 3h18l-2-3V9c0-4-3-7-7-7z" fill="#15172B" />
              <Circle cx={9.5} cy={10.5} r={1.3} fill="#7CF5C4" />
              <Circle cx={14.5} cy={10.5} r={1.3} fill="#7CF5C4" />
            </Svg>
          </LinearGradient>
        </Animated.View>
        <Animated.View style={[styles.speech, now === 'locked' && { backgroundColor: '#E7F8EE' }, wrong && now === null && { transform: [{ translateX: shake }] }]}>
          <Text style={{ color: now === 'locked' ? '#166534' : INK, fontFamily: now === 'locked' || wrong ? F.head : F.body, fontSize: 14, lineHeight: 19.5 }}>{bubble}</Text>
          <Text style={{ marginTop: 4, color: '#6A3DF0', fontFamily: F.head, fontSize: 11.5 }}>
            {SPOTS[round.spot].name} · round {Math.min(r + 1, n)} of {n}
          </Text>
        </Animated.View>
      </View>
      <Text style={[styles.hint, { marginTop: 12, marginBottom: 8 }]}>Which lock stops him?</Text>
      <View style={styles.locks}>
        {LOCKS.map((l, j) => {
          const ok = now === 'locked' && j === FIX[round.kind];
          const no = wrong?.j === j && now === null;
          return (
            <Pressable key={j} onPress={() => pick(j)} style={[styles.lockBtn, ok && { borderColor: '#16A34A', backgroundColor: '#E7F8EE' }, no && { borderColor: '#E5243B', backgroundColor: '#FFF0F2' }]} accessibilityRole="button">
              <View style={[styles.lockIcon, { backgroundColor: ok ? '#16A34A' : '#6A3DF0' }]}>
                <MaterialCommunityIcons name={l.icon} size={17} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: INK, fontFamily: F.head, fontSize: 13, lineHeight: 16 }} numberOfLines={2}>{l.name}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 5. What do you do first? Tap the steps in order; each one drops into its numbered slot.
// ------------------------------------------------------------------------------------------------
type StepLook = { icon: IconName; colour: string };
export function stepLook(text: string): StepLook {
  const t = text.toLowerCase();
  if (/(two[- ]?(factor|step)|2fa|mfa|authenticator|2-step)/.test(t)) return { icon: 'cellphone-key', colour: '#0EA5E9' };
  if (/(same password|other accounts|reuse|elsewhere)/.test(t)) return { icon: 'link-variant', colour: '#6366F1' };
  if (/(password|passcode|pin\b|passphrase)/.test(t)) return { icon: 'key-variant', colour: '#F59E0B' };
  if (/(email|phishing|message|text|sms|link)/.test(t)) return { icon: 'email-outline', colour: '#EC4899' };
  if (/(bank|card|statement|money|payment|credit)/.test(t)) return { icon: 'credit-card-outline', colour: '#10B981' };
  if (/(update|patch|install)/.test(t)) return { icon: 'update', colour: '#2563EB' };
  if (/(report|police|call|contact|tell)/.test(t)) return { icon: 'phone-outline', colour: '#F97316' };
  if (/(disconnect|unplug|offline|isolate)/.test(t)) return { icon: 'lan-disconnect', colour: '#EF4444' };
  if (/(back ?up)/.test(t)) return { icon: 'backup-restore', colour: '#14B8A6' };
  return { icon: 'shield-check-outline', colour: '#8B5CF6' };
}
const SHUFFLE = [2, 0, 3, 1];
export function StepSlots({ game, image }: Props) {
  const hud = useHud();
  const d: { ask: string; steps: string[]; why: string } = game.data;
  const steps = (d?.steps ?? []).filter(Boolean).slice(0, 4);
  const n = steps.length;
  const [placed, setPlaced] = useState<number[]>([]);
  const [misses, setMisses] = useState(0);
  const [wrong, setWrong] = useState<{ k: number; n: number } | null>(null);
  const shake = useShake(wrong ? `${wrong.k}-${wrong.n}` : null);
  const pop = usePop(placed.length || null, 0.4);
  useEffect(() => hud.step(0, n), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (n < 2) return null;
  const looks = steps.map(stepLook);
  const tap = (k: number) => {
    if (placed.includes(k)) return;
    if (k === placed.length) {
      const next = [...placed, k];
      setPlaced(next);
      setWrong(null);
      hud.step(next.length, n);
      if (next.length === n) {
        buzz.right();
        setTimeout(() => hud.finish({ won: true, score: Math.max(0, n - misses), total: n, xp: Math.max(40, 120 - misses * 20), badge: misses === 0 ? 'order_steps' : undefined, line: d.why }), 1200);
      } else buzz.tap();
    } else {
      buzz.wrong();
      hud.miss();
      setMisses((m) => m + 1);
      setWrong((x) => ({ k, n: (x?.n ?? 0) + 1 }));
    }
  };
  return (
    <View style={{ flexGrow: 1 }}>
      {!!image && (
        <View style={styles.orderPic}>
          <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        </View>
      )}
      {!!d.ask && <Text style={[styles.hint, { marginTop: image ? 10 : 2, color: 'rgba(21,23,43,0.7)' }]} numberOfLines={2}>{sentences(d.ask)[0]}</Text>}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingHorizontal: 4 }}>
        {steps.map((_, i) => {
          const k = placed[i];
          const L = k != null ? looks[k] : null;
          return (
            <Animated.View key={i} style={[styles.slot, L ? { backgroundColor: L.colour, borderWidth: 0 } : null, i === placed.length - 1 && { transform: [{ scale: pop }] }]}>
              {L ? <MaterialCommunityIcons name={L.icon} size={26} color="#FFFFFF" /> : <Text style={styles.slotNum}>{i + 1}</Text>}
              {L && (
                <View style={styles.slotTick}>
                  <MaterialCommunityIcons name="check-bold" size={11} color="#FFFFFF" />
                </View>
              )}
            </Animated.View>
          );
        })}
      </View>
      <View style={styles.tiles}>
        {SHUFFLE.filter((k) => k < n).map((k) => {
          const done = placed.includes(k);
          const L = looks[k];
          return (
            <Animated.View key={k} style={[{ width: '48.5%' }, wrong?.k === k ? { transform: [{ translateX: shake }] } : null]}>
              <Pressable onPress={() => tap(k)} disabled={done} style={[styles.stepTile, done && styles.stepDone, wrong?.k === k && { borderColor: '#E5243B', borderWidth: 2 }]} accessibilityRole="button">
                <View style={[styles.stepIcon, { backgroundColor: L.colour }]}>
                  <MaterialCommunityIcons name={L.icon} size={17} color="#FFFFFF" />
                </View>
                <Text style={{ marginTop: 6, color: INK, fontFamily: F.head, fontSize: 12.5, lineHeight: 16 }} numberOfLines={3}>{steps[k]}</Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
      <View style={{ marginTop: 10, minHeight: 24 }}>
        {wrong ? (
          <Text style={[styles.hint, { color: '#E5243B', fontFamily: F.head }]}>Not yet: something else comes first. You lost a heart.</Text>
        ) : (
          <Text style={styles.hint}>{placed.length ? `Yes! ${placed.length} of ${n} in the right order` : 'Tap the step you would do first'}</Text>
        )}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 6. Crack-o-meter: tap random words to build a passphrase. The vault ring fills; the hacker gives up.
// ------------------------------------------------------------------------------------------------
const LEVELS = [
  { crack: 'Instantly', c: '#E5243B', face: '😏', line: 'Hacker: "Empty? Too easy."' },
  { crack: 'A few seconds', c: '#E5243B', face: '😏', line: 'Hacker: "One word? Seconds."' },
  { crack: 'About 3 hours', c: '#F97316', face: '🤔', line: 'Hacker: "Hmm. Coffee time."' },
  { crack: 'About 300 years', c: '#D9A400', face: '😟', line: 'Hacker: "That is not fair."' },
  { crack: '4 centuries+', c: '#16A34A', face: '😫', line: 'Hacker: "Four random words? I give up."' },
];
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VAULT = require('../../assets/games/vault.jpg');
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
export function VaultCrack({ game, active }: Props) {
  const hud = useHud();
  const pool: string[] = (game.data?.words ?? []).filter(Boolean).slice(0, 8);
  const [words, setWords] = useState<string[]>([]);
  const [weak, setWeak] = useState(false);
  const level = weak ? 0 : Math.min(words.length, 4);
  const L = LEVELS[level];
  const fill = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const pop = usePop(level, 0.6);
  const done = useRef(false);
  useEffect(() => hud.step(0, 4), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    Animated.spring(fill, { toValue: weak ? 0.04 : level / 4, friction: 7, useNativeDriver: false }).start();
    if (!weak) hud.step(level, 4);
    if (level === 4 && !done.current) {
      done.current = true;
      buzz.right();
      setTimeout(() => hud.finish({ won: true, score: 4, total: 4, xp: 100, badge: 'crack_meter', line: 'Random words beat clever swaps like P@ssw0rd. Use a password manager for the rest.' }), 1800);
    }
  }, [level, weak]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 18000, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [active, spin]);
  if (pool.length < 4) return null;
  const R = 104;
  const C = 2 * Math.PI * R;
  return (
    <View style={{ flexGrow: 1, alignItems: 'stretch' }}>
      <View style={{ alignSelf: 'center', width: 224, height: 224, alignItems: 'center', justifyContent: 'center' }}>
        <View style={styles.vault}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
            <Image source={VAULT} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="A vault door with a glowing dial" />
          </Animated.View>
        </View>
        <Svg width={224} height={224} viewBox="0 0 224 224" style={StyleSheet.absoluteFill}>
          <Defs>
            <SvgGradient id="cg" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#FF8A00" />
              <Stop offset="0.5" stopColor="#FFD000" />
              <Stop offset="1" stopColor="#16A34A" />
            </SvgGradient>
          </Defs>
          <Circle cx={112} cy={112} r={R} fill="none" stroke="rgba(14,124,134,0.12)" strokeWidth={10} />
          <AnimatedCircle
            cx={112} cy={112} r={R} fill="none" stroke="url(#cg)" strokeWidth={10} strokeLinecap="round"
            strokeDasharray={`${C} ${C}`}
            strokeDashoffset={fill.interpolate({ inputRange: [0, 1], outputRange: [C, 0] })}
            transform="rotate(-90 112 112)"
          />
        </Svg>
      </View>
      <View style={styles.pwField}>
        <Text style={{ flex: 1, fontFamily: MONO_BOLD, fontSize: 16, color: weak ? '#E5243B' : INK }} numberOfLines={1} adjustsFontSizeToFit>
          {weak ? 'Password1!' : words.join('') || ' '}
        </Text>
        <View style={{ width: 2, height: 20, backgroundColor: '#0E7C86' }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 10 }}>
        <Text style={{ color: 'rgba(21,23,43,0.6)', fontFamily: F.head, fontSize: 12.5 }}>TIME TO CRACK</Text>
        <Animated.Text style={{ color: L.c, fontFamily: F.brand, fontSize: 24, transform: [{ scale: pop }] }}>{L.crack}</Animated.Text>
      </View>
      <View style={styles.chips}>
        {pool.map((wd) => {
          const used = !weak && words.includes(wd);
          return (
            <Pressable
              key={wd}
              disabled={used || level === 4}
              onPress={() => {
                buzz.tick();
                setWeak(false);
                setWords((cur) => (weak ? [wd] : [...cur, wd]).slice(0, 4));
              }}
              style={[styles.chip, used && styles.chipUsed]}
              accessibilityRole="button"
            >
              <Text style={{ color: used ? 'rgba(21,23,43,0.35)' : INK, fontFamily: F.head, fontSize: 14 }}>{wd}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.hacker}>
        <Text style={{ fontSize: 26 }}>{weak ? '😏' : L.face}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 13, lineHeight: 18 }}>{weak ? 'Hacker: "Password1! is in every list. Instantly."' : L.line}</Text>
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 4 }}>
            <Pressable onPress={() => { setWeak(true); setWords([]); buzz.wrong(); }} hitSlop={8} disabled={level === 4}>
              <Text style={styles.hackerLink}>Try "Password1!"</Text>
            </Pressable>
            <Pressable onPress={() => { setWeak(false); setWords([]); }} hitSlop={8} disabled={level === 4}>
              <Text style={styles.hackerLink}>Start again</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { textAlign: 'center', color: 'rgba(21,23,43,0.55)', fontFamily: F.medium, fontSize: 12.5, marginTop: 6 },
  // scam
  stackCard: { position: 'absolute', top: 0 },
  noteCard: { borderRadius: 26, backgroundColor: '#FFFFFF', overflow: 'hidden', shadowColor: '#78283C', shadowOpacity: 0.18, shadowRadius: 25, shadowOffset: { width: 0, height: 18 }, elevation: 8 },
  lock: { height: 118, alignItems: 'center', justifyContent: 'center' },
  lockTime: { color: '#FFFFFF', fontFamily: F.body, fontSize: 42, letterSpacing: -1, lineHeight: 46, fontWeight: '300' },
  lockDate: { color: 'rgba(255,255,255,0.75)', fontFamily: F.medium, fontSize: 12 },
  note: { marginTop: -30, marginHorizontal: 12, padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.98)', shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 11, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  appIcon: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#34C759', alignItems: 'center', justifyContent: 'center' },
  stamp: { position: 'absolute', top: 18, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 3, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.9)' },
  stampText: { fontFamily: F.brand, fontSize: 24, letterSpacing: 2 },
  bigBtn: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 6, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  // link
  browser: { borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(21,23,43,0.08)', padding: 12, paddingTop: 10, shadowColor: '#283278', shadowOpacity: 0.1, shadowRadius: 13, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  urlBar: { flex: 1, marginLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#F2F3F7' },
  skel: { height: 9, borderRadius: 5, backgroundColor: '#EFF1F6' },
  tag: { position: 'absolute', left: 14, top: -11, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  tagText: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 11 },
  lensWrap: { position: 'absolute', right: 6, top: -26, width: 132, height: 132 },
  lens: { width: 120, height: 120, borderRadius: 60, backgroundColor: '#FFFFFF', borderWidth: 6, borderColor: INK, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, shadowColor: INK, shadowOpacity: 0.28, shadowRadius: 17, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  lensHandle: { position: 'absolute', right: 2, bottom: 0, width: 14, height: 46, borderRadius: 7, backgroundColor: INK, transform: [{ rotate: '-45deg' }] },
  // flags
  flagBox: { width: 26, height: 26, borderRadius: 8, backgroundColor: 'rgba(21,23,43,0.08)', alignItems: 'center', justifyContent: 'center' },
  mail: { borderRadius: 24, backgroundColor: '#FFFFFF', padding: 12, gap: 4, shadowColor: '#1E3C6E', shadowOpacity: 0.14, shadowRadius: 22, shadowOffset: { width: 0, height: 14 }, elevation: 6 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mailLine: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  mailBtn: { borderRadius: 12, backgroundColor: '#1F6FEB', paddingVertical: 11, marginHorizontal: 6, marginVertical: 4 },
  mailHit: { backgroundColor: '#FFE1E5', borderWidth: 1.5, borderColor: '#FF9AAB' },
  pin: { position: 'absolute', right: -8, top: -10, width: 26, height: 26, borderRadius: 13, backgroundColor: '#E5243B', alignItems: 'center', justifyContent: 'center', shadowColor: '#E5243B', shadowOpacity: 0.35, shadowRadius: 5, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  tipCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: '#FFFFFF', shadowColor: '#1E3C6E', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  tipIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  // home
  house: { borderRadius: 26, overflow: 'hidden', backgroundColor: '#EDE6FF', shadowColor: '#5032B4', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 18 }, elevation: 6 },
  housePin: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', shadowColor: '#28145A', shadowOpacity: 0.3, shadowRadius: 7, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  pinRing: { position: 'absolute', left: 0, top: 0, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,77,109,0.45)' },
  lockedChip: { position: 'absolute', right: 12, bottom: 12, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)' },
  burglar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  speech: { flex: 1, padding: 12, borderRadius: 18, borderTopLeftRadius: 4, backgroundColor: '#FFFFFF', shadowColor: '#5032B4', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  locks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  lockBtn: { width: '48.5%', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(106,61,240,0.2)', backgroundColor: 'rgba(255,255,255,0.85)' },
  lockIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // order
  orderPic: { height: 130, borderRadius: 22, overflow: 'hidden', backgroundColor: '#DDEFE6', shadowColor: '#14503C', shadowOpacity: 0.14, shadowRadius: 15, shadowOffset: { width: 0, height: 14 }, elevation: 5 },
  slot: { width: 64, height: 64, borderRadius: 21, borderWidth: 2.5, borderStyle: 'dashed', borderColor: 'rgba(21,23,43,0.2)', backgroundColor: 'rgba(255,255,255,0.6)', alignItems: 'center', justifyContent: 'center' },
  slotNum: { color: 'rgba(21,23,43,0.25)', fontFamily: F.brand, fontSize: 22 },
  slotTick: { position: 'absolute', right: -6, top: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#16A34A', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 14 },
  stepTile: { minHeight: 92, borderRadius: 18, padding: 11, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: 'transparent', shadowColor: '#14503C', shadowOpacity: 0.12, shadowRadius: 11, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  stepDone: { opacity: 0.4, backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: 'rgba(21,23,43,0.2)', shadowOpacity: 0, elevation: 0 },
  stepIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // crack
  vault: { width: 190, height: 190, borderRadius: 95, overflow: 'hidden', backgroundColor: '#0E3B44' },
  pwField: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: '#FFFFFF', shadowColor: '#0E7C86', shadowOpacity: 0.12, shadowRadius: 11, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12, backgroundColor: '#FFFFFF', shadowColor: '#143C5A', shadowOpacity: 0.1, shadowRadius: 7, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  chipUsed: { backgroundColor: 'rgba(255,255,255,0.35)', shadowOpacity: 0, elevation: 0 },
  hacker: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 12, borderRadius: 18, backgroundColor: INK },
  hackerLink: { color: '#7CF5C4', fontFamily: F.head, fontSize: 12, textDecorationLine: 'underline' },
});
