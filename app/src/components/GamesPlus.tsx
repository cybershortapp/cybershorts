import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { buzz } from '../lib/buzz';
import type { Game } from '../lib/extras';
import { BADGES, recordResult } from '../lib/progress';
import { F } from '../theme';

/**
 * The "real life" games (release 1.0.4): a help desk phone call, your phone under a sign-in
 * prompt attack, and a scammer's look at an overshared profile. (The digital home game is in GamesVisual.)
 * The words come from the server (written from the story); the look and rules live here.
 * Each one shows how to play first, and reports its result for XP and badges.
 */
type Props = { game: Game; active: boolean };

// ---- small shared pieces ----
function useLoop(duration: number, on = true) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [v, duration, on]);
  return v;
}
function Enter({ k, children, style }: { k: unknown; children: React.ReactNode; style?: object }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [k, v]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>;
}
function Hand() {
  const v = useLoop(1100);
  return (
    <Animated.Text style={{ fontSize: 30, transform: [{ translateY: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 8, 0] }) }] }}>👆</Animated.Text>
  );
}
function Reward({ won, xp, badge, ink, title, text, onAgain, tone }: { won: boolean; xp: number; badge: string | null; ink: string; title: string; text: string; onAgain: () => void; tone: string }) {
  return (
    <Enter k={title} style={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 10 }}>
      <View style={[styles.medal, { backgroundColor: won ? '#FACC15' : '#EF4444' }]}>
        <Text style={{ fontSize: 42 }}>{won ? (badge ? BADGES[badge].icon : '🏅') : '💥'}</Text>
      </View>
      {!!badge && <Text style={[styles.kick, { color: '#FACC15', marginTop: 12 }]}>BADGE UNLOCKED · {BADGES[badge].name.toUpperCase()}</Text>}
      <Text style={{ color: ink, fontFamily: F.brand, fontSize: 22, lineHeight: 27, textAlign: 'center', marginTop: 8 }}>{title}</Text>
      <Text style={{ color: ink, opacity: 0.8, fontFamily: F.body, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 }}>{text}</Text>
      <Pressable onPress={onAgain} style={[styles.btn, { backgroundColor: tone, marginTop: 16, alignSelf: 'stretch' }]} accessibilityRole="button">
        <Text style={{ color: '#0B1020', fontFamily: F.head, fontSize: 15 }}>Play again{xp ? ` · +${xp} XP` : ''}</Text>
      </Pressable>
    </Enter>
  );
}

// ------------------------------------------------------------------------------------------------
// 1. Help desk hot seat: you're on the IT help desk and "a colleague" rings, locked out and in a hurry.
// ------------------------------------------------------------------------------------------------
type HotOpt = { t: string; kind: 'good' | 'weak' | 'bad'; reply?: string };
export function HotSeat({ game }: Props) {
  const d: { caller: { name: string; role: string }; rounds: { say: string; options: HotOpt[] }[]; win: string; lose: string } = game.data;
  const [phase, setPhase] = useState<'ring' | 'call' | 'won' | 'lost'>('ring');
  const [declined, setDeclined] = useState(false);
  const [r, setR] = useState(0);
  const [log, setLog] = useState<{ who: 'them' | 'me' | 'note'; text: string }[]>([]);
  const [weak, setWeak] = useState(0);
  const [used, setUsed] = useState<string[]>([]);
  const [secs, setSecs] = useState(0);
  const [reward, setReward] = useState<{ xp: number; badge: string | null }>({ xp: 0, badge: null });
  const ring = useLoop(1600, phase === 'ring');
  const wave = useLoop(900, phase === 'call');
  useEffect(() => {
    if (phase !== 'call') return;
    const id = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);
  if (!d?.caller?.name || !Array.isArray(d.rounds) || !d.rounds.length) return null;
  const initials = d.caller.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const pressure = Math.min(100, 25 + r * 28 + weak * 18);
  const start = () => {
    setPhase('call');
    setR(0);
    setLog([{ who: 'them', text: d.rounds[0].say }]);
    setWeak(0);
    setUsed([]);
    setSecs(0);
  };
  const end = (won: boolean) => {
    const stars = won ? Math.max(1, 3 - weak) : 0;
    const res = recordResult({ game: 'hot_seat', won, xp: won ? stars * 100 : 20, badge: won && weak === 0 ? 'hot_seat' : undefined });
    setReward({ xp: res.xp, badge: res.newBadge });
    setPhase(won ? 'won' : 'lost');
    (won ? buzz.right : buzz.wrong)();
  };
  const pick = (o: HotOpt) => {
    const next = [...log, { who: 'me' as const, text: o.t }];
    setUsed((u) => [...u, o.t]);
    if (o.kind === 'bad') {
      setLog(next);
      end(false);
      return;
    }
    if (o.kind === 'weak') {
      buzz.tap();
      setWeak((w) => w + 1);
      setLog([...next, { who: 'them', text: o.reply || 'Come on, quick!' }, { who: 'note', text: 'Attackers find details like this online in seconds.' }]);
      return;
    }
    buzz.tick();
    if (r + 1 >= d.rounds.length) {
      setLog(next);
      end(true);
      return;
    }
    setR(r + 1);
    setLog([...next, { who: 'them', text: d.rounds[r + 1].say }]);
  };

  if (phase === 'ring') {
    return (
      <View style={{ flexGrow: 1, alignItems: 'center', paddingHorizontal: 18 }}>
        <Text style={[styles.kick, { color: '#7DD3FC' }]}>YOU'RE ON THE IT HELP DESK TODAY</Text>
        <View style={{ width: 110, height: 110, marginTop: 18, alignItems: 'center', justifyContent: 'center' }}>
          {[0, 0.5].map((off) => (
            <Animated.View key={off} style={[StyleSheet.absoluteFill, { borderRadius: 55, borderWidth: 2, borderColor: 'rgba(125,211,252,0.6)', opacity: ring.interpolate({ inputRange: [0, 1], outputRange: off ? [0.3, 0] : [0.6, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: off ? [1.4, 2] : [1, 1.8] }) }] }]} />
          ))}
          <LinearGradient colors={['#64748B', '#1E293B']} style={styles.avatar}>
            <Text style={{ color: '#E2E8F0', fontFamily: F.brand, fontSize: 36 }}>{initials}</Text>
          </LinearGradient>
        </View>
        <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 25, marginTop: 14 }}>{d.caller.name}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.body, fontSize: 13.5, marginTop: 3 }}>{d.caller.role} · incoming call</Text>
        <View style={styles.warnChip}>
          <Text style={{ color: '#FFB86B', fontFamily: F.head, fontSize: 12 }}>Not the number we have on file</Text>
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: F.body, fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 12 }}>
          {declined ? "Ignoring it won't help. They'll keep calling. Answer it." : 'Answer, then pick what you say. Can you keep the attackers out?'}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', paddingHorizontal: 34, marginTop: 18 }}>
          <Pressable onPress={() => setDeclined(true)} style={[styles.callBtn, { backgroundColor: '#EF4444' }]} accessibilityLabel="Decline">
            <MaterialCommunityIcons name="phone-hangup" size={28} color="#FFFFFF" />
          </Pressable>
          <Pressable onPress={start} style={[styles.callBtn, { backgroundColor: '#22C55E' }]} accessibilityLabel="Answer">
            <MaterialCommunityIcons name="phone" size={28} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    );
  }
  if (phase === 'won' || phase === 'lost') {
    return (
      <Reward won={phase === 'won'} xp={reward.xp} badge={reward.badge} ink="#FFFFFF" tone={phase === 'won' ? '#FACC15' : '#FFFFFF'} onAgain={() => setPhase('ring')}
        title={phase === 'won' ? 'Call ended. They hung up.' : 'Two hours later, the servers went dark'}
        text={phase === 'won' ? (weak ? `${d.win} Next time skip the checks they can look up online.` : d.win) : `${d.lose} Never reset anything from a call: ring back on the number you already have.`} />
    );
  }
  const round = d.rounds[Math.min(r, d.rounds.length - 1)];
  const mm = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 14 }}>
      <View style={styles.callBar}>
        <LinearGradient colors={['#64748B', '#1E293B']} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#E2E8F0', fontFamily: F.head, fontSize: 14 }}>{initials}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 14 }}>"{d.caller.name}"</Text>
          <Text style={{ color: '#4ADE80', fontFamily: 'JetBrainsMono_700Bold', fontSize: 11.5 }}>● {mm}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center', height: 26 }}>
          {[0, 0.3, 0.6, 0.15, 0.45].map((off, k) => (
            <Animated.View key={k} style={{ width: 4, height: 22, borderRadius: 2, backgroundColor: '#4ADE80', transform: [{ scaleY: wave.interpolate({ inputRange: [0, off, Math.min(1, off + 0.5), 1], outputRange: [0.3, 1, 0.3, 0.3] }) }] }} />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
        <Text style={[styles.kick, { color: 'rgba(255,255,255,0.55)' }]}>CALLER PRESSURE</Text>
        <Text style={[styles.kick, { color: pressure > 70 ? '#EF4444' : pressure > 45 ? '#F97316' : '#FACC15' }]}>{pressure > 70 ? 'FURIOUS' : pressure > 45 ? 'PUSHY' : 'POLITE'}</Text>
      </View>
      <View style={styles.meter}>
        <LinearGradient colors={['#FACC15', '#F97316', '#EF4444']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: '100%', width: `${pressure}%` }} />
      </View>
      <View style={{ gap: 7, marginTop: 10 }}>
        {log.slice(-4).map((m, k) => (
          <Enter key={`${log.length}-${k}`} k={log.length} style={m.who === 'me' ? styles.me : m.who === 'note' ? styles.note : styles.them}>
            <Text style={{ color: m.who === 'note' ? '#FFB86B' : '#FFFFFF', fontFamily: m.who === 'note' ? F.head : F.body, fontSize: m.who === 'note' ? 12 : 14, lineHeight: m.who === 'note' ? 16 : 19 }}>{m.text}</Text>
          </Enter>
        ))}
      </View>
      <Text style={[styles.kick, { color: 'rgba(255,255,255,0.5)', marginTop: 12 }]}>WHAT DO YOU SAY?</Text>
      <View style={{ gap: 7, marginTop: 7 }}>
        {round.options.filter((o) => !used.includes(o.t)).map((o) => (
          <Pressable key={o.t} onPress={() => pick(o)} style={styles.reply} accessibilityRole="button">
            <Text style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 14, lineHeight: 19 }}>{o.t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 2. Don't tap Approve: the hackers have your password and flood your phone with sign-in prompts.
// ------------------------------------------------------------------------------------------------
type Note = { at: number; kind: 'mfa' | 'real'; app: string; title: string; body: string; icon: string; tint: string };
const REAL_ICON: Record<string, [string, string]> = { MESSAGES: ['💬', '#22C55E'], BANK: ['£', '#0EA5E9'], CALENDAR: ['📅', '#F97316'], EMAIL: ['✉️', '#6366F1'] };
export function Approve({ game, active }: Props) {
  const d: { place: string; real: { app: string; title: string; body: string }[]; call: { name: string; say: string } } = game.data;
  const [phase, setPhase] = useState<'intro' | 'play' | 'call' | 'won' | 'lost'>('intro');
  const [t, setT] = useState(0);
  const [gone, setGone] = useState<Record<number, true>>({});
  const [denied, setDenied] = useState(0);
  const [how, setHow] = useState<'approve' | 'flood' | 'call'>('approve');
  const [reward, setReward] = useState<{ xp: number; badge: string | null }>({ xp: 0, badge: null });
  const goneRef = useRef(gone);
  goneRef.current = gone;
  const valid = !!d?.call?.say && Array.isArray(d.real) && d.real.length >= 2;
  const plan: Note[] = (() => {
    if (!valid) return [];
    const M = (at: number): Note => ({ at, kind: 'mfa', app: 'AUTHENTICATOR', title: 'Approve sign-in?', body: `Your work account · ${d.place || 'Unknown place'} · Windows`, icon: '🔑', tint: '#2563EB' });
    const R = (at: number, k: number): Note => {
      const x = d.real[k % d.real.length];
      const [icon, tint] = REAL_ICON[(x.app || '').toUpperCase()] ?? ['💬', '#22C55E'];
      return { at, kind: 'real', app: (x.app || 'MESSAGES').toUpperCase(), title: x.title, body: x.body, icon, tint };
    };
    return [M(0.8), M(2.4), R(3.4, 0), M(4.2), M(5.0), R(6.0, 1), M(6.8), M(7.3), M(7.8), R(8.8, 2), M(9.5), M(9.9), M(10.3), M(10.7), M(11.1), M(11.5)];
  })();
  const END = 12.5;
  useEffect(() => {
    if (phase !== 'play' || !active) return;
    const id = setInterval(() => setT((x) => x + 0.05), 50);
    return () => clearInterval(id);
  }, [phase, active]);
  // too many prompts left waiting, or the flood is over and "IT" rings
  useEffect(() => {
    if (phase !== 'play') return;
    const waitingNow = plan.filter((p, k) => p.kind === 'mfa' && p.at <= t && !goneRef.current[k]).length;
    if (waitingNow >= 6) {
      setHow('flood');
      finish(false);
    } else if (t >= END) setPhase('call');
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!valid) return null;
  function finish(won: boolean) {
    const res = recordResult({ game: 'approve', won, xp: won ? 150 + denied * 10 : 20, badge: won ? 'approve' : undefined });
    setReward({ xp: res.xp, badge: res.newBadge });
    setPhase(won ? 'won' : 'lost');
    (won ? buzz.right : buzz.wrong)();
  }
  const start = () => {
    setT(0);
    setGone({});
    setDenied(0);
    setPhase('play');
  };
  const live = plan.map((p, k) => ({ ...p, k })).filter((p) => p.at <= t && !gone[p.k]).reverse();
  const waiting = live.filter((p) => p.kind === 'mfa').length;

  if (phase === 'intro') {
    return (
      <Wall>
        <Text style={[styles.kick, { color: '#FDE68A', textAlign: 'center' }]}>A REAL TRICK · IT HIT UBER IN 2022</Text>
        <Text style={{ color: '#FFFFFF', fontFamily: F.body, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 }}>
          Hackers already have your password. Now they'll <Text style={{ fontFamily: F.head }}>flood your phone</Text> with sign-in requests, hoping you tap Approve to make it stop.
        </Text>
        <View style={[styles.glass, { marginTop: 16 }]}>
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 14 }}>Approve sign-in?</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <View style={[styles.deny, { flex: 1 }]}><Text style={{ color: '#DC2626', fontFamily: F.head, fontSize: 14 }}>Deny</Text></View>
            <View style={[styles.approve, { flex: 1 }]}><Text style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 14 }}>Approve</Text></View>
          </View>
          <View style={{ position: 'absolute', left: 54, bottom: -18 }}><Hand /></View>
        </View>
        <Text style={{ color: '#FFFFFF', fontFamily: F.body, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 22 }}>
          Tap <Text style={{ fontFamily: F.head }}>Deny</Text> on every sign-in you didn't start. Clear real messages with ✕.
        </Text>
        <Pressable onPress={start} style={[styles.btn, { backgroundColor: '#FFFFFF', marginTop: 16 }]} accessibilityRole="button">
          <Text style={{ color: '#4C1D95', fontFamily: F.head, fontSize: 15 }}>I'm ready</Text>
        </Pressable>
      </Wall>
    );
  }
  if (phase === 'call') {
    return (
      <View style={[styles.wall, { backgroundColor: '#0F172A' }]}>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.body, fontSize: 12.5, textAlign: 'center' }}>incoming call · a minute later</Text>
        <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 22, textAlign: 'center', marginTop: 6 }}>"{d.call.name}"</Text>
        <View style={[styles.them, { marginTop: 14, alignSelf: 'stretch', maxWidth: '100%' }]}>
          <Text style={{ color: '#FFFFFF', fontFamily: F.body, fontSize: 14.5, lineHeight: 21 }}>"{d.call.say}"</Text>
        </View>
        <Text style={[styles.kick, { color: 'rgba(255,255,255,0.55)', marginTop: 16 }]}>WHAT DO YOU DO?</Text>
        <Pressable onPress={() => { setHow('call'); finish(false); }} style={[styles.reply, { marginTop: 8 }]} accessibilityRole="button">
          <Text style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 14 }}>"OK, approving it now. Thanks!"</Text>
        </Pressable>
        <Pressable onPress={() => finish(true)} style={[styles.reply, { marginTop: 8 }]} accessibilityRole="button">
          <Text style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 14 }}>Hang up and call IT on the number on our intranet</Text>
        </Pressable>
      </View>
    );
  }
  if (phase === 'won' || phase === 'lost') {
    return (
      <View style={[styles.wall, { backgroundColor: phase === 'won' ? '#064E3B' : '#450A0A' }]}>
        <Reward won={phase === 'won'} xp={reward.xp} badge={reward.badge} ink="#FFFFFF" tone={phase === 'won' ? '#FACC15' : '#FFFFFF'} onAgain={start}
          title={phase === 'won' ? `${denied} prompts denied, and the fake IT call spotted` : how === 'call' ? 'The "IT" call was the hacker' : how === 'flood' ? 'Too many prompts piled up' : 'You approved the hacker'}
          text={phase === 'won' ? 'That last call is where a real Uber worker gave in.' : 'If you did not just try to sign in, always tap Deny, then tell IT your password has leaked.'} />
      </View>
    );
  }
  return (
    <Wall>
      <Text style={{ color: '#FFFFFF', fontFamily: F.body, fontSize: 52, lineHeight: 58, textAlign: 'center', fontWeight: '300' }}>08:15</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.kick, { color: '#FFFFFF' }]}>PROMPTS PILING UP</Text>
        <View style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${Math.min(100, (waiting / 6) * 100)}%`, backgroundColor: waiting >= 4 ? '#EF4444' : waiting >= 2 ? '#F59E0B' : '#4ADE80' }} />
        </View>
        <Text style={{ color: '#FFFFFF', fontFamily: 'JetBrainsMono_700Bold', fontSize: 12 }}>{Math.max(0, Math.ceil(END - t))}s</Text>
      </View>
      <View style={{ gap: 8, marginTop: 10 }}>
        {live.slice(0, 3).map((p) => (
          <Enter key={p.k} k={p.k} style={styles.glass}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: p.tint, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 11, color: '#FFFFFF' }}>{p.icon}</Text></View>
              <Text style={{ flex: 1, color: 'rgba(255,255,255,0.85)', fontFamily: F.head, fontSize: 11, letterSpacing: 0.4 }}>{p.app}</Text>
              {p.kind === 'real' && (
                <Pressable onPress={() => setGone((g) => ({ ...g, [p.k]: true }))} hitSlop={8} style={styles.x} accessibilityLabel="Clear">
                  <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 12 }}>✕</Text>
                </Pressable>
              )}
            </View>
            <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 14, marginTop: 4 }}>{p.title}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: F.body, fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>{p.body}</Text>
            {p.kind === 'mfa' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Pressable onPress={() => { setGone((g) => ({ ...g, [p.k]: true })); setDenied((x) => x + 1); buzz.tick(); }} style={[styles.deny, { flex: 1 }]} accessibilityRole="button">
                  <Text style={{ color: '#DC2626', fontFamily: F.head, fontSize: 14 }}>Deny</Text>
                </Pressable>
                <Pressable onPress={() => { setHow('approve'); finish(false); }} style={[styles.approve, { flex: 1 }]} accessibilityRole="button">
                  <Text style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 14 }}>Approve</Text>
                </Pressable>
              </View>
            )}
          </Enter>
        ))}
        {live.length > 3 && <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 12.5, textAlign: 'center' }}>+{live.length - 3} more waiting…</Text>}
      </View>
    </Wall>
  );
}

// the lock screen's wallpaper (defined once, outside the game, so it is never rebuilt while the clock ticks)
function Wall({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.wall}>
      <LinearGradient colors={['#1E3A8A', '#6D28D9', '#DB2777']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {children}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 4. Overshare detective: you're the scammer. Tap what on this (made-up) profile would get you in.
// ------------------------------------------------------------------------------------------------
type Post = { emoji: string; caption: string; risky: boolean; what?: string; why?: string };
export function Overshare({ game, active }: Props) {
  const d: { name: string; handle: string; job: string; bio: { text: string; what: string; why: string }; posts: Post[] } = game.data;
  const [phase, setPhase] = useState<'intro' | 'play' | 'end'>('intro');
  const [found, setFound] = useState<Record<string, true>>({});
  const [t, setT] = useState(0);
  const [pen, setPen] = useState(0);
  const [clue, setClue] = useState<{ text: string; good: boolean; at: number } | null>(null);
  const [reward, setReward] = useState<{ xp: number; badge: string | null }>({ xp: 0, badge: null });
  const valid = !!d?.name && !!d.bio?.text && Array.isArray(d.posts) && d.posts.length >= 6;
  const posts = valid ? d.posts.slice(0, 8) : [];
  const total = 1 + posts.filter((p) => p.risky).length;
  const n = Object.keys(found).length;
  const TIME = 45;
  useEffect(() => {
    if (phase !== 'play' || !active) return;
    const id = setInterval(() => setT((x) => x + 0.1), 100);
    return () => clearInterval(id);
  }, [phase, active]);
  useEffect(() => {
    if (phase === 'play' && t + pen >= TIME) end();
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!valid) return null;
  function end(all = false) {
    const got = all ? total : Object.keys(found).length;
    const res = recordResult({ game: 'overshare', won: got >= total - 1, xp: got * 40, badge: got === total ? 'overshare' : undefined });
    setReward({ xp: res.xp, badge: res.newBadge });
    setPhase('end');
  }
  const tap = (id: string, risky: boolean, what?: string, why?: string) => {
    if (phase !== 'play' || found[id]) return;
    if (!risky) {
      setPen((p) => p + 3);
      setClue({ text: 'Nothing useful for a scammer here. That one is fine to share.', good: false, at: t });
      buzz.wrong();
      return;
    }
    const next = { ...found, [id]: true as const };
    setFound(next);
    setClue({ text: `${what}: ${why}`, good: true, at: t });
    buzz.right();
    if (Object.keys(next).length >= total) setTimeout(() => end(true), 1200);
  };
  const initials = d.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (phase === 'intro') {
    return (
      <View style={{ flexGrow: 1, paddingHorizontal: 18, alignItems: 'center' }}>
        <Text style={{ fontSize: 44 }}>🕵️</Text>
        <Text style={[styles.kick, { color: '#B45309', marginTop: 6 }]}>STEP 1 OF MOST ATTACKS: RESEARCH</Text>
        <Text style={{ color: '#0F172A', fontFamily: F.body, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 10 }}>
          Before attacking, criminals study people online. Now <Text style={{ fontFamily: F.head }}>you're the scammer</Text>. Tap the {total} things on {d.name.split(' ')[0]}'s profile that would help you break into their accounts.
        </Text>
        <View style={{ marginTop: 10 }}><Hand /></View>
        <Pressable onPress={() => { setPhase('play'); setFound({}); setT(0); setPen(0); setClue(null); }} style={[styles.btn, { backgroundColor: '#0F172A', marginTop: 8, alignSelf: 'stretch' }]} accessibilityRole="button">
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 15 }}>Start snooping</Text>
        </Pressable>
      </View>
    );
  }
  if (phase === 'end') {
    const risky = [{ id: 'bio', what: d.bio.what, why: d.bio.why }, ...posts.map((p, j) => ({ id: `p${j}`, what: p.what, why: p.why, risky: p.risky })).filter((p) => p.risky)];
    return (
      <View style={{ flexGrow: 1, paddingHorizontal: 16 }}>
        <Text style={[styles.kick, { color: '#B45309' }]}>{n === total ? 'ALL FOUND · CASE CLOSED' : `${n} OF ${total} FOUND`}{reward.xp ? ` · +${reward.xp} XP` : ''}</Text>
        <Text style={{ color: '#0F172A', fontFamily: F.brand, fontSize: 20, lineHeight: 25, marginTop: 4 }}>The scammer's notebook</Text>
        {!!reward.badge && <Text style={{ color: '#B45309', fontFamily: F.head, fontSize: 12.5, marginTop: 4 }}>{BADGES[reward.badge].icon} Badge unlocked: {BADGES[reward.badge].name}</Text>}
        <View style={styles.notebook}>
          {risky.map((x) => (
            <Text key={x.id} style={{ color: '#422006', fontFamily: F.body, fontSize: 12.5, lineHeight: 17, opacity: found[x.id] ? 1 : 0.55 }}>
              <Text style={{ fontFamily: F.head }}>{found[x.id] ? '✓' : '✗'} {x.what}:</Text> {x.why}
            </Text>
          ))}
        </View>
        <Text style={{ color: '#334155', fontFamily: F.body, fontSize: 12.5, lineHeight: 18, marginTop: 8 }}>Now check your own profile: hide your birthday, post holidays after you're back, and never use pets or family names in passwords.</Text>
        <Pressable onPress={() => setPhase('intro')} style={[styles.btn, { backgroundColor: '#0F172A', marginTop: 10 }]} accessibilityRole="button">
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 15 }}>Play again</Text>
        </Pressable>
      </View>
    );
  }
  const showClue = clue && t - clue.at < 3.2;
  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <LinearGradient colors={['#F97316', '#DB2777', '#7C3AED']} style={{ width: 54, height: 54, borderRadius: 27, padding: 2.5 }}>
          <View style={{ flex: 1, borderRadius: 25, backgroundColor: '#FB7185', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 18 }}>{initials}</Text>
          </View>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#0F172A', fontFamily: F.brand, fontSize: 16 }}>{d.name}</Text>
          <Text style={{ color: '#64748B', fontFamily: F.body, fontSize: 12 }} numberOfLines={1}>{d.handle} · {d.job}</Text>
        </View>
        <View style={{ backgroundColor: '#0F172A', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 11.5 }}>🕵 {n}/{total} · {Math.max(0, Math.ceil(TIME - t - pen))}s</Text>
        </View>
      </View>
      <Pressable onPress={() => tap('bio', true, d.bio.what, d.bio.why)} style={[styles.bio, found.bio && styles.foundBox]} accessibilityRole="button">
        <Text style={{ color: '#0F172A', fontFamily: F.label, fontSize: 12.5, lineHeight: 17 }}>{d.bio.text}</Text>
        {found.bio && <Text style={styles.stamp}>FOUND</Text>}
      </Pressable>
      <View style={styles.posts}>
        {posts.map((p, j) => {
          const id = `p${j}`, f = !!found[id];
          return (
            <Pressable key={id} onPress={() => tap(id, p.risky, p.what, p.why)} style={[styles.post, f && styles.foundBox]} accessibilityRole="button">
              <View style={[styles.postPic, { backgroundColor: ['#FDE68A', '#BAE6FD', '#FBCFE8', '#BBF7D0', '#DDD6FE', '#FED7AA'][j % 6] }]}>
                <Text style={{ fontSize: 26 }}>{p.emoji}</Text>
              </View>
              <Text style={{ color: '#0F172A', fontFamily: F.body, fontSize: 11, lineHeight: 14, padding: 6 }} numberOfLines={2}>{p.caption}</Text>
              {f && <Text style={[styles.stamp, { top: 16, left: 18 }]}>FOUND</Text>}
            </Pressable>
          );
        })}
      </View>
      {showClue && (
        <Enter k={clue!.at} style={[styles.clue, { backgroundColor: clue!.good ? '#0F172A' : '#64748B' }]}>
          <Text style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 12.5, lineHeight: 17 }}>{clue!.good ? '🔎 ' : '🤷 '}{clue!.text}</Text>
        </Enter>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  kick: { fontFamily: F.head, fontSize: 10.5, letterSpacing: 1.4 },
  btn: { height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  medal: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  warnChip: { marginTop: 10, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,184,107,0.15)', borderWidth: 1, borderColor: 'rgba(255,184,107,0.4)' },
  callBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  callBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.07)' },
  meter: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginTop: 5 },
  them: { alignSelf: 'flex-start', maxWidth: '85%', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, borderBottomLeftRadius: 4 },
  me: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: '#2563F5', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 16, borderBottomRightRadius: 4 },
  note: { alignSelf: 'center', backgroundColor: 'rgba(255,184,107,0.14)', borderWidth: 1, borderColor: 'rgba(255,184,107,0.4)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  reply: { paddingHorizontal: 13, paddingVertical: 11, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(125,211,252,0.35)', backgroundColor: 'rgba(37,99,245,0.16)' },
  wall: { flexGrow: 1, marginHorizontal: 10, borderRadius: 22, overflow: 'hidden', padding: 14 },
  glass: { borderRadius: 18, padding: 11, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  deny: { height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  approve: { height: 36, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  x: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  bio: { marginTop: 8, padding: 8, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
  foundBox: { borderColor: '#DC2626', borderStyle: 'solid', backgroundColor: 'rgba(220,38,38,0.05)' },
  stamp: { position: 'absolute', right: 8, top: 6, color: '#DC2626', borderWidth: 2, borderColor: '#DC2626', borderRadius: 6, paddingHorizontal: 6, fontFamily: F.head, fontSize: 11, letterSpacing: 1, backgroundColor: 'rgba(255,255,255,0.85)', transform: [{ rotate: '-8deg' }] },
  posts: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  post: { width: '48.6%', borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  postPic: { height: 44, alignItems: 'center', justifyContent: 'center' },
  clue: { marginTop: 8, padding: 10, borderRadius: 14 },
  notebook: { marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: '#FEF9C3', gap: 6 },
});
