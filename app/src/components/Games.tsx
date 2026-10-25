import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import type { Game } from '../lib/extras';
import { buzz } from '../lib/buzz';
import { F } from '../theme';
import { Fit } from './Fit';
import { Approve, Home, HotSeat, Overshare } from './GamesPlus';

type GameProps = { game: Game; active: boolean };

const TITLES: Record<Game['style'], string> = {
  scam_or_legit: 'Scam or legit? Drag it.',
  patch_or_panic: 'Patch or panic',
  red_flags: 'Spot the 4 red flags',
  real_link: 'Which link is real?',
  order_steps: 'What do you do first?',
  crack_meter: "Build a password the hacker can't crack",
  hot_seat: 'Help desk hot seat',
  approve: "Don't tap Approve",
  home: 'Lock up your digital home',
  overshare: 'Overshare detective',
};

/** A game card in the feed, shown after the story it's about. */
export function GameCard({ game, headline, width, height, active }: { game: Game; headline: string; width: number; height: number; active: boolean }) {
  const Body = { scam_or_legit: ScamOrLegit, patch_or_panic: PatchOrPanic, red_flags: RedFlags, real_link: RealLink, order_steps: OrderSteps, crack_meter: CrackMeter, hot_seat: HotSeat, approve: Approve, home: Home, overshare: Overshare }[game.style];
  const theme = THEME[game.style];
  if (!Body) return null;
  return (
    <View style={{ width, height, borderRadius: 24, overflow: 'hidden', backgroundColor: theme.bg }}>
      <View style={styles.head}>
        <Text style={[styles.kicker, { color: theme.accent }]}>30 SECOND GAME</Text>
        <Text style={[styles.about, { color: theme.muted }]} numberOfLines={2}>About: {headline}</Text>
        <Text style={[styles.title, { color: theme.ink }]}>{TITLES[game.style]}</Text>
      </View>
      <Fit>
        <Body game={game} active={active} />
      </Fit>
      <Text style={[styles.foot, { color: theme.muted }]}>Swipe up to skip · Turn games off in Settings</Text>
    </View>
  );
}

const THEME: Record<Game['style'], { bg: string; ink: string; muted: string; accent: string }> = {
  scam_or_legit: { bg: '#FFF4E6', ink: '#1A1530', muted: '#6B6385', accent: '#B42318' },
  patch_or_panic: { bg: '#161A40', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.6)', accent: '#FDE68A' },
  red_flags: { bg: '#D6EFFC', ink: '#10233A', muted: '#4B6178', accent: '#B42318' },
  real_link: { bg: '#FFF8EC', ink: '#1E1A14', muted: '#7A6F5E', accent: '#B45309' },
  order_steps: { bg: '#F1EEFF', ink: '#1C1440', muted: '#5D5585', accent: '#6A3FE0' },
  crack_meter: { bg: '#0F1420', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.6)', accent: '#4ADE80' },
  hot_seat: { bg: '#0D1325', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.6)', accent: '#7DD3FC' },
  approve: { bg: '#120B2E', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.6)', accent: '#F0ABFC' },
  home: { bg: '#141238', ink: '#FFFFFF', muted: 'rgba(255,255,255,0.6)', accent: '#FDE68A' },
  overshare: { bg: '#F8FAFC', ink: '#0F172A', muted: '#64748B', accent: '#B45309' },
};

// ---- little pieces shared by the games ----
function Line({ text, good }: { text: string; good: boolean }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [text, pop]);
  if (!text) return null;
  return (
    <Animated.Text style={[styles.line, { color: good ? '#0F7A47' : '#B42318', opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}>
      {text}
    </Animated.Text>
  );
}

function useBounce(trigger: unknown) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (trigger == null) return;
    v.setValue(0);
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.spring(v, { toValue: 0, friction: 3, useNativeDriver: true }),
    ]).start();
  }, [trigger, v]);
  return v;
}

function Done({ title, text, onAgain, colour = '#1A1530', button = '#FDE68A' }: { title: string; text: string; onAgain: () => void; colour?: string; button?: string }) {
  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [pop]);
  return (
    <Animated.View style={[styles.done, { backgroundColor: colour, opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}>
      <Text style={styles.doneKicker}>BADGE UNLOCKED</Text>
      <Text style={styles.doneTitle}>{title}</Text>
      <Text style={styles.doneText}>{text}</Text>
      <Pressable onPress={onAgain} style={[styles.again, { backgroundColor: button }]} accessibilityRole="button">
        <Text style={styles.againText}>Play again</Text>
      </Pressable>
    </Animated.View>
  );
}

// ------------------------------------------------------------------------------------------------
// 1. Scam or legit: drag each message left (scam) or right (legit). The shield cheers or shakes.
// ------------------------------------------------------------------------------------------------
function ScamOrLegit({ game }: GameProps) {
  const items: { from: string; msg: string; scam: boolean; why: string }[] = game.data.items ?? [];
  const [i, setI] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [line, setLine] = useState('');
  const [mood, setMood] = useState<'idle' | 'good' | 'bad'>('idle');
  const pan = useRef(new Animated.ValueXY()).current;
  const state = useRef({ i: 0 });
  state.current.i = i;
  const shake = useBounce(mood === 'idle' ? null : `${mood}${results.length}`);

  const answer = (saidScam: boolean) => {
    const item = items[state.current.i];
    if (!item) return;
    const right = saidScam === item.scam;
    setResults((r) => [...r, right]);
    setMood(right ? 'good' : 'bad');
    (right ? buzz.right : buzz.wrong)();
    setLine(right ? `Nice! ${item.why}` : `Gotcha. ${item.why}`);
    setI((k) => k + 1);
    pan.setValue({ x: 0, y: 0 });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_, g) => {
          if (g.dx < -90 || g.dx > 90) {
            // read the direction now: the phone resets the gesture numbers before the fly-off animation ends
            const saidScam = g.dx < 0;
            Animated.timing(pan, { toValue: { x: saidScam ? -420 : 420, y: g.dy }, duration: 180, useNativeDriver: false }).start(() => answer(saidScam));
          } else {
            Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 5, useNativeDriver: false }).start();
          }
        },
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const done = i >= items.length;
  const score = results.filter(Boolean).length;
  const item = items[Math.min(i, items.length - 1)];
  const rotate = pan.x.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-14deg', '0deg', '14deg'] });
  const scamGlow = pan.x.interpolate({ inputRange: [-120, -40, 0], outputRange: [1, 0.2, 0], extrapolate: 'clamp' });
  const legitGlow = pan.x.interpolate({ inputRange: [0, 40, 120], outputRange: [0, 0.2, 1], extrapolate: 'clamp' });
  const bad = mood === 'bad';

  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={{ alignSelf: 'center', marginTop: 6, transform: bad ? [{ translateX: shake.interpolate({ inputRange: [0, 1], outputRange: [0, 10] }) }] : [{ translateY: shake.interpolate({ inputRange: [0, 1], outputRange: [0, -22] }) }] }}>
        <Svg width={84} height={92} viewBox="0 0 96 104">
          <Path d="M48 4 L88 18 L88 50 C88 76 70 92 48 100 C26 92 8 76 8 50 L8 18 Z" fill={bad ? '#FFB4A8' : '#9FE8C0'} stroke="#1A1530" strokeWidth={4} strokeLinejoin="round" />
          <Circle cx={34} cy={48} r={bad ? 3 : 5} fill="#1A1530" />
          <Circle cx={62} cy={48} r={bad ? 3 : 5} fill="#1A1530" />
          <Path d={bad ? 'M34 76 Q48 66 62 76' : 'M32 68 Q48 84 64 68'} fill="none" stroke="#1A1530" strokeWidth={4} strokeLinecap="round" />
        </Svg>
      </Animated.View>
      <View style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 24 }}>
        <Line text={line} good={mood !== 'bad'} />
      </View>
      <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: 12, gap: 8 }}>
        <View style={[styles.bin, { borderColor: '#B42318' }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(180,35,24,0.16)', opacity: scamGlow, borderRadius: 20 }]} />
          <MaterialCommunityIcons name="alert-outline" size={30} color="#B42318" />
          <Text style={[styles.binText, { color: '#B42318' }]}>SCAM</Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {!done && item && (
            <Animated.View {...responder.panHandlers} style={[styles.chip, { transform: [{ translateX: pan.x }, { translateY: pan.y }, { rotate }] }]}>
              <Text style={styles.chipFrom} numberOfLines={1}>{item.from}</Text>
              <Text style={styles.chipMsg}>{item.msg}</Text>
              <Text style={styles.chipHint}>‹ drag left or right ›</Text>
            </Animated.View>
          )}
        </View>
        <View style={[styles.bin, { borderColor: '#0F7A47' }]}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(15,122,71,0.16)', opacity: legitGlow, borderRadius: 20 }]} />
          <MaterialCommunityIcons name="check-bold" size={30} color="#0F7A47" />
          <Text style={[styles.binText, { color: '#0F7A47' }]}>LEGIT</Text>
        </View>
      </View>
      <View style={styles.dots}>
        {items.map((_, k) => (
          <View key={k} style={[styles.dotS, { backgroundColor: k < results.length ? (results[k] ? '#0F7A47' : '#B42318') : 'rgba(26,21,48,0.18)' }]} />
        ))}
      </View>
      {done && (
        <Done
          title={score === items.length ? 'Scam Spotter' : score >= items.length - 1 ? 'Sharp Eyes' : 'Rookie Detective'}
          text={`You got ${score} out of ${items.length}. ${score === items.length ? 'Criminals hate you.' : 'Have another go, they are sneaky.'}`}
          onAgain={() => { setI(0); setResults([]); setLine(''); setMood('idle'); }}
        />
      )}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 2. Patch or panic: answer before the fuse burns down. Right: the bomb is defused. Wrong: boom.
// ------------------------------------------------------------------------------------------------
const FUSE = 12;
function PatchOrPanic({ game, active }: GameProps) {
  const qs: { q: string; options: string[]; answer: number; why: string }[] = game.data.questions ?? [];
  const [i, setI] = useState(0);
  const [t, setT] = useState(FUSE);
  const [picked, setPicked] = useState<number | null>(null); // -1 = ran out of time
  const [score, setScore] = useState(0);
  const wobble = useRef(new Animated.Value(0)).current;
  const result = picked !== null;
  const right = result && picked === qs[i]?.answer;

  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(wobble, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(wobble, { toValue: -1, duration: 250, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [wobble]);
  useEffect(() => {
    if (!active || result) return;
    const id = setInterval(() => setT((x) => {
      if (x <= 1) {
        setPicked(-1);
        buzz.wrong(); // the bomb goes off
        return 0;
      }
      return x - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [active, result, i]);

  const q = qs[i];
  if (!q) return null;
  const pick = (k: number) => {
    if (result) return;
    setPicked(k);
    if (k === q.answer) setScore((s) => s + 1);
    (k === q.answer ? buzz.right : buzz.wrong)();
  };
  const last = i === qs.length - 1;
  const boom = result && !right;

  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 18 }}>
      <View style={styles.fuseTrack}>
        <View style={[styles.fuse, { width: `${result ? (right ? 100 : 0) : (t / FUSE) * 100}%` }]} />
      </View>
      <View style={{ height: 150, alignItems: 'center', justifyContent: 'center' }}>
        {boom ? (
          <Svg width={170} height={134} viewBox="0 0 190 150">
            <Path d="M95 8 L112 48 L156 30 L134 70 L182 84 L136 98 L158 140 L110 116 L95 146 L80 116 L32 140 L54 98 L8 84 L56 70 L34 30 L78 48 Z" fill="#FF8A3D" stroke="#FDE68A" strokeWidth={5} strokeLinejoin="round" />
          </Svg>
        ) : (
          <Animated.View style={{ transform: [{ rotate: wobble.interpolate({ inputRange: [-1, 1], outputRange: [result ? '0deg' : '-4deg', result ? '0deg' : '4deg'] }) }] }}>
            <Svg width={130} height={140} viewBox="0 0 150 160">
              <Path d="M98 34 Q112 14 126 18" fill="none" stroke="#C9A27A" strokeWidth={5} strokeLinecap="round" />
              {!result && <Circle cx={128} cy={17} r={9} fill="#FDE68A" />}
              <Rect x={80} y={34} width={26} height={20} rx={4} fill="#3A3F66" />
              <Circle cx={70} cy={96} r={54} fill="#23264A" stroke="#0A0B20" strokeWidth={4} />
              <Circle cx={56} cy={98} r={right ? 7 : 6} fill="#FFFFFF" />
              <Circle cx={86} cy={98} r={right ? 7 : 6} fill="#FFFFFF" />
              <Path d={right ? 'M54 116 Q71 130 88 116' : 'M58 122 Q71 114 84 122'} fill="none" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" />
            </Svg>
          </Animated.View>
        )}
      </View>
      {boom && <Text style={styles.boomText}>BOOM</Text>}
      <Text style={styles.qCount}>{i + 1} / {qs.length}</Text>
      <Text style={styles.q}>{q.q}</Text>
      <View style={{ gap: 10, marginTop: 12 }}>
        {q.options.map((o, k) => {
          const isRight = result && k === q.answer;
          const isWrong = result && k === picked && k !== q.answer;
          return (
            <Pressable key={k} onPress={() => pick(k)} style={[styles.opt, isRight && { borderColor: '#4ADE80', backgroundColor: 'rgba(74,222,128,0.16)' }, isWrong && { borderColor: '#FF8A80', backgroundColor: 'rgba(255,138,128,0.16)' }]} accessibilityRole="button">
              <Text style={styles.optText}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
      {result && (
        <View style={{ marginTop: 12, gap: 10, alignItems: 'center' }}>
          <Text style={[styles.why, { color: right ? '#4ADE80' : '#FF8A80' }]}>
            {right ? 'Defused! ' : picked === -1 ? 'Too slow. ' : 'Boom. '}{q.why}
          </Text>
          <Pressable
            onPress={() => { if (last) { setI(0); setScore(0); } else setI(i + 1); setPicked(null); setT(FUSE); }}
            style={styles.yellowBtn}
            accessibilityRole="button"
          >
            <Text style={styles.yellowBtnText}>{last ? `Score ${score} / ${qs.length} · Play again` : 'Next question'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 3. Spot the red flags: tap the 4 giveaways in a fake message to hook the phish.
// ------------------------------------------------------------------------------------------------
function RedFlags({ game }: GameProps) {
  const lines: { text: string; flag: boolean; why: string }[] = game.data.lines ?? [];
  const [found, setFound] = useState<number[]>([]);
  const [tip, setTip] = useState<{ text: string; bad: boolean } | null>(null);
  const fish = useRef(new Animated.Value(0)).current;
  const total = lines.filter((l) => l.flag).length;
  const won = found.length === total && total > 0;
  useEffect(() => {
    if (won) Animated.timing(fish, { toValue: 1, duration: 1000, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
    else {
      fish.setValue(0);
    }
  }, [won, fish]);
  const swim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(swim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(swim, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [swim]);

  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 14 }}>
      <Text style={[styles.counter, { color: '#10233A' }]}>{found.length} / {total} found</Text>
      <View style={styles.mail}>
        {lines.map((l, k) => {
          const hit = found.includes(k);
          return (
            <Pressable
              key={k}
              onPress={() => {
                if (l.flag) {
                  if (!hit) {
                    setFound((f) => [...f, k]);
                    buzz.right();
                  }
                  setTip({ text: l.why, bad: false });
                } else {
                  setTip({ text: 'Nope, that bit is fine. Keep looking.', bad: true });
                  buzz.wrong();
                }
              }}
              style={[styles.mailLine, hit && styles.mailHit]}
              accessibilityRole="button"
            >
              <Text style={[styles.mailText, k === 1 && { fontFamily: F.head }]}>{l.text}</Text>
            </Pressable>
          );
        })}
      </View>
      {tip && !won && (
        <View style={[styles.tip, { backgroundColor: tip.bad ? '#6B7A90' : '#E5372A' }]}>
          <Text style={styles.tipText}>{tip.text}</Text>
        </View>
      )}
      <Animated.View
        style={{
          position: 'absolute', alignSelf: 'center', bottom: 6,
          transform: [
            { translateX: swim.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) },
            { translateY: fish.interpolate({ inputRange: [0, 1], outputRange: [0, -320] }) },
            { rotate: fish.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-40deg'] }) },
          ],
          opacity: fish.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
        }}
        pointerEvents="none"
      >
        <Svg width={80} height={54} viewBox="0 0 90 60">
          <Path d="M70 30 L88 14 L88 46 Z" fill="#FF8A3D" stroke="#10233A" strokeWidth={3} strokeLinejoin="round" />
          <Ellipse cx={40} cy={30} rx={34} ry={22} fill="#FFB86B" stroke="#10233A" strokeWidth={3} />
          <Circle cx={22} cy={24} r={5} fill="#FFFFFF" stroke="#10233A" strokeWidth={2} />
          <Circle cx={21} cy={24} r={2.5} fill="#10233A" />
        </Svg>
      </Animated.View>
      {won && (
        <Done colour="#10233A" button="#FFB86B" title="Phish fried." text="Any one of those giveaways is enough reason to stop and check another way."
          onAgain={() => { setFound([]); setTip(null); }} />
      )}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 4. Which link is real? Pick the real address; the fake part lights up red.
// ------------------------------------------------------------------------------------------------
function RealLink({ game }: GameProps) {
  const d: { ask: string; options: { url: string; odd: string; why: string }[]; answer: number } = game.data;
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  const right = picked === d.answer;
  const pulse = useBounce(picked);
  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 16 }}>
      <Text style={[styles.q, { color: '#1E1A14', marginTop: 4 }]}>{d.ask}</Text>
      <View style={{ gap: 12, marginTop: 14 }}>
        {d.options.map((o, k) => {
          const isOk = k === d.answer;
          const show = answered && (isOk || k === picked);
          const at = o.odd ? o.url.indexOf(o.odd) : -1;
          const parts = at >= 0 ? [o.url.slice(0, at), o.url.slice(at, at + o.odd.length), o.url.slice(at + o.odd.length)] : [o.url, '', ''];
          return (
            <Animated.View key={k} style={show ? { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }] } : undefined}>
              <Pressable
                onPress={() => {
                  if (answered) return;
                  setPicked(k);
                  (k === d.answer ? buzz.right : buzz.wrong)();
                }}
                style={[styles.link, answered && isOk && { borderColor: '#0F7A47', backgroundColor: '#E7F7EE' }, answered && k === picked && !isOk && { borderColor: '#B42318', backgroundColor: '#FDECEA' }]}
                accessibilityRole="button"
              >
                <Text style={styles.linkText}>
                  https://{parts[0]}
                  <Text style={answered && !isOk ? styles.odd : undefined}>{parts[1]}</Text>
                  {parts[2]}
                </Text>
                {show && <Text style={styles.linkWhy}>{o.why}</Text>}
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
      {answered && (
        <View style={{ alignItems: 'center', marginTop: 16, gap: 10 }}>
          <Text style={[styles.verdict, { color: right ? '#0F7A47' : '#B42318' }]}>{right ? 'Eagle eyes. Correct.' : 'Caught you. Look at the red part.'}</Text>
          <Pressable onPress={() => setPicked(null)} style={[styles.yellowBtn, { backgroundColor: '#1E1A14' }]} accessibilityRole="button">
            <Text style={[styles.yellowBtnText, { color: '#FFFFFF' }]}>Try again</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.linkTip}>Tip: the real site is the part just before the first single /</Text>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 5. What do you do first? Tap the steps in the right order.
// ------------------------------------------------------------------------------------------------
const SHUFFLE = [2, 0, 3, 1];
const OOPS = ['Hold on, the thief can still get in.', 'Close, but the front door is still open.', 'Brave move. Wrong order though.'];
function OrderSteps({ game }: GameProps) {
  const d: { ask: string; steps: string[]; why: string } = game.data;
  const [placed, setPlaced] = useState<number[]>([]);
  const [line, setLine] = useState<{ text: string; good: boolean }>({ text: 'Order matters. Go.', good: true });
  const [wrong, setWrong] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const shake = useBounce(wrong === null ? null : `${wrong}${tries}`);
  const done = placed.length === d.steps.length;
  const stamp = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (done) Animated.spring(stamp, { toValue: 1, friction: 4, useNativeDriver: true }).start();
    else stamp.setValue(0);
  }, [done, stamp]);
  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 16 }}>
      <Text style={[styles.q, { color: '#1C1440', fontSize: 17, lineHeight: 23 }]}>{d.ask}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 12 }}>
        {d.steps.map((_, k) => (
          <View key={k} style={[styles.num, { backgroundColor: k < placed.length ? '#0F7A47' : '#C4B8F5' }]}>
            <Text style={styles.numText}>{k < placed.length ? '\u2713' : k + 1}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.line, { color: line.good ? '#0F7A47' : '#B42318', marginTop: 10 }]}>{done ? d.why : line.text}</Text>
      <View style={{ gap: 10, marginTop: 12 }}>
        {SHUFFLE.filter((k) => k < d.steps.length).map((k) => {
          const at = placed.indexOf(k);
          return (
            <Animated.View key={k} style={wrong === k ? { transform: [{ translateX: shake.interpolate({ inputRange: [0, 1], outputRange: [0, 10] }) }] } : undefined}>
              <Pressable
                disabled={at >= 0 || done}
                onPress={() => {
                  if (k === placed.length) {
                    setPlaced((p) => [...p, k]);
                    if (placed.length + 1 === d.steps.length) buzz.right();
                    else buzz.tap();
                    setLine({ text: ['Yes. Lock the door first.', 'Good, one step closer.', 'Nice. Nearly there.', ''][placed.length], good: true });
                    setWrong(null);
                  } else {
                    setWrong(k);
                    buzz.wrong();
                    setTries((n) => n + 1);
                    setLine({ text: OOPS[tries % OOPS.length], good: false });
                  }
                }}
                style={[styles.tile, at >= 0 && styles.tileDone]}
                accessibilityRole="button"
              >
                {at >= 0 && (
                  <View style={[styles.num, styles.tileNum]}>
                    <Text style={styles.numText}>{at + 1}</Text>
                  </View>
                )}
                <Text style={[styles.tileText, { flex: 1 }, at >= 0 && { color: '#0F4D2E' }]}>{d.steps[k]}</Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
      {done && (
        <Animated.View style={[styles.stamp, { opacity: stamp, transform: [{ rotate: '-10deg' }, { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [2, 1] }) }] }]}>
          <Text style={styles.stampText}>BREACH-PROOF</Text>
          <Pressable onPress={() => { setPlaced([]); setLine({ text: 'Order matters. Go.', good: true }); }} hitSlop={10}>
            <Text style={styles.stampAgain}>Play again</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// 6. Crack-o-meter: tap words to build a passphrase; the hacker sweats, then rage quits.
// ------------------------------------------------------------------------------------------------
const LEVELS = [
  { crack: 'Instantly', w: 4, c: '#FF5A4E', line: 'Hacker: "Too easy, mate."', mouth: 'M64 70 Q75 80 86 70' },
  { crack: 'A few seconds', w: 12, c: '#FF5A4E', line: 'Hacker: "Seconds. Next."', mouth: 'M64 70 Q75 80 86 70' },
  { crack: 'About 3 hours', w: 35, c: '#FFB86B', line: 'Hacker: "Hmm. Coffee time."', mouth: 'M64 72 L86 72' },
  { crack: 'About 300 years', w: 68, c: '#FDE68A', line: 'Hacker: "That is not fair."', mouth: 'M64 76 Q75 68 86 76' },
  { crack: 'Longer than the universe', w: 100, c: '#4ADE80', line: 'Hacker: rage quits.', mouth: 'M62 78 Q75 66 88 78' },
];
function CrackMeter({ game }: GameProps) {
  const pool: string[] = (game.data.words ?? []).slice(0, 8);
  const [words, setWords] = useState<string[]>([]);
  const [weak, setWeak] = useState(false);
  const L = LEVELS[weak ? 0 : Math.min(words.length, 4)];
  const meter = useRef(new Animated.Value(4)).current;
  const rage = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(meter, { toValue: L.w, friction: 6, useNativeDriver: false }).start();
  }, [L.w, meter]);
  useEffect(() => {
    if (L.w < 100) return;
    buzz.right(); // the hacker rage quits
    const a = Animated.loop(Animated.sequence([
      Animated.timing(rage, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.timing(rage, { toValue: -1, duration: 90, useNativeDriver: true }),
    ]), { iterations: 8 });
    a.start();
    return () => a.stop();
  }, [L.w, rage]);
  return (
    <View style={{ flexGrow: 1, paddingHorizontal: 16 }}>
      <Animated.View style={{ alignSelf: 'center', transform: [{ rotate: rage.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }) }] }}>
        <Svg width={130} height={112} viewBox="0 0 150 130">
          <Path d="M40 70 Q40 20 75 20 Q110 20 110 70 Z" fill="#2A3350" stroke="#4ADE80" strokeWidth={3} />
          <Circle cx={75} cy={58} r={24} fill="#F2C9A0" />
          <Rect x={56} y={50} width={38} height={10} rx={5} fill="#0F1420" />
          <Path d={L.mouth} fill="none" stroke="#0F1420" strokeWidth={3} strokeLinecap="round" />
          <Rect x={30} y={92} width={90} height={34} rx={5} fill="#2A3350" stroke="#4ADE80" strokeWidth={3} />
          <Circle cx={75} cy={109} r={5} fill="#4ADE80" />
          {L.w >= 35 && <Path d="M106 46 Q110 54 106 58 Q102 54 106 46 Z" fill="#7DD3FC" />}
        </Svg>
      </Animated.View>
      <Text style={[styles.line, { color: 'rgba(255,255,255,0.8)' }]}>{weak ? 'Hacker: "Ha. Top 10 most used. Instantly."' : L.line}</Text>
      <View style={styles.pw}><Text style={styles.pwText}>{weak ? 'Password1!' : words.join('') || ' '}</Text></View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontFamily: F.label, fontSize: 13 }}>Time to crack (rough guide)</Text>
        <Text style={{ color: L.c, fontFamily: F.head, fontSize: 13 }}>{L.crack}</Text>
      </View>
      <View style={styles.meterTrack}>
        <Animated.View style={{ height: '100%', backgroundColor: L.c, width: meter.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />
      </View>
      <View style={styles.words}>
        {pool.filter((w) => !words.includes(w)).map((w) => (
          <Pressable key={w} onPress={() => { setWeak(false); setWords((cur) => (weak ? [w] : [...cur, w]).slice(0, 5)); }} style={styles.word} accessibilityRole="button">
            <Text style={styles.wordText}>{w}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Pressable onPress={() => { setWeak(true); setWords([]); buzz.wrong(); }} style={[styles.ghost, { borderColor: '#FF8A80' }]}><Text style={{ color: '#FF8A80', fontFamily: F.head, fontSize: 13.5 }}>Try Password1!</Text></Pressable>
        <Pressable onPress={() => { setWeak(false); setWords([]); }} style={[styles.ghost, { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' }]}><Text style={{ color: '#0F1420', fontFamily: F.head, fontSize: 13.5 }}>Start again</Text></Pressable>
      </View>
      <Text style={[styles.foot, { color: 'rgba(255,255,255,0.55)', position: 'relative', marginTop: 10 }]}>Three or four random words beat a short password with symbols.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingTop: 50, paddingBottom: 10, gap: 3 },
  kicker: { fontFamily: F.head, fontSize: 11.5, letterSpacing: 1.6 },
  about: { fontFamily: F.medium, fontSize: 12 },
  title: { fontFamily: F.brand, fontSize: 23, lineHeight: 28, letterSpacing: -0.5, marginTop: 4 },
  foot: { textAlign: 'center', fontFamily: F.medium, fontSize: 11.5, paddingBottom: 12 },
  line: { textAlign: 'center', fontFamily: F.head, fontSize: 14, lineHeight: 20 },
  done: { position: 'absolute', left: 24, right: 24, top: '28%', borderRadius: 24, padding: 22, alignItems: 'center', gap: 8 },
  doneKicker: { color: '#FDE68A', fontFamily: F.head, fontSize: 12, letterSpacing: 2 },
  doneTitle: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 26 },
  doneText: { color: 'rgba(255,255,255,0.85)', fontFamily: F.body, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  again: { marginTop: 6, borderRadius: 22, paddingHorizontal: 22, minHeight: 44, justifyContent: 'center' },
  againText: { color: '#1A1530', fontFamily: F.head, fontSize: 14 },
  bin: { width: 78, borderWidth: 3, borderStyle: 'dashed', borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.5)' },
  binText: { fontFamily: F.brand, fontSize: 14 },
  chip: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 2, borderColor: '#1A1530', padding: 12, shadowColor: '#1A1530', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  chipFrom: { fontFamily: F.head, fontSize: 12.5, color: '#4A4360', marginBottom: 6 },
  chipMsg: { fontFamily: F.label, fontSize: 14, lineHeight: 20, color: '#1A1530' },
  chipHint: { fontFamily: F.medium, fontSize: 11, color: '#8A83A0', textAlign: 'center', marginTop: 8 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: 10 },
  dotS: { width: 10, height: 10, borderRadius: 5 },
  fuseTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  fuse: { height: '100%', backgroundColor: '#FF8A3D' },
  boomText: { position: 'absolute', top: 80, alignSelf: 'center', color: '#FFFFFF', fontFamily: F.brand, fontSize: 28 },
  qCount: { color: '#FDE68A', fontFamily: F.head, fontSize: 12, letterSpacing: 1 },
  q: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 19, lineHeight: 25, marginTop: 4 },
  opt: { minHeight: 50, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  optText: { color: '#FFFFFF', fontFamily: F.label, fontSize: 14.5, lineHeight: 20 },
  why: { fontFamily: F.label, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  yellowBtn: { minHeight: 46, borderRadius: 23, paddingHorizontal: 22, backgroundColor: '#FDE68A', justifyContent: 'center' },
  yellowBtnText: { color: '#14163A', fontFamily: F.head, fontSize: 14.5 },
  counter: { fontFamily: F.head, fontSize: 13, textAlign: 'right', marginBottom: 6 },
  mail: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 10, gap: 4, shadowColor: '#10233A', shadowOpacity: 0.15, shadowRadius: 14, elevation: 4 },
  mailLine: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7 },
  mailHit: { borderWidth: 3, borderColor: '#E5372A', backgroundColor: 'rgba(229,55,42,0.06)' },
  mailText: { color: '#10233A', fontFamily: F.label, fontSize: 14, lineHeight: 19 },
  tip: { marginTop: 10, borderRadius: 14, padding: 12 },
  tipText: { color: '#FFFFFF', fontFamily: F.label, fontSize: 13.5, lineHeight: 19 },
  link: { minHeight: 60, borderRadius: 16, borderWidth: 2, borderColor: '#E8DCC6', backgroundColor: '#FFFFFF', padding: 14 },
  linkText: { fontFamily: 'JetBrainsMono_400Regular', fontSize: 14.5, lineHeight: 21, color: '#1E1A14' },
  linkWhy: { fontFamily: F.label, fontSize: 13, lineHeight: 18, marginTop: 8, color: '#1E1A14' },
  odd: { backgroundColor: '#B42318', color: '#FFFFFF' },
  verdict: { fontFamily: F.brand, fontSize: 17 },
  linkTip: { marginTop: 'auto', paddingTop: 12, paddingBottom: 4, textAlign: 'center', color: '#8A7F6E', fontFamily: F.medium, fontSize: 12 },
  num: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  numText: { color: '#FFFFFF', fontFamily: F.head, fontSize: 14 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: 14, borderWidth: 2, borderColor: '#1C1440', backgroundColor: '#FFFFFF', paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center', shadowColor: '#1C1440', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  tileDone: { borderColor: '#0F7A47', backgroundColor: '#E9F8EF', shadowColor: '#0F7A47' },
  tileNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#0F7A47' },
  tileText: { color: '#1C1440', fontFamily: F.head, fontSize: 14.5, lineHeight: 19 },
  stamp: { alignSelf: 'center', marginTop: 16, borderWidth: 5, borderColor: '#0F7A47', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.7)' },
  stampText: { color: '#0F7A47', fontFamily: F.brand, fontSize: 24, letterSpacing: 1 },
  stampAgain: { color: '#1C1440', fontFamily: F.head, fontSize: 13, marginTop: 6, textDecorationLine: 'underline' },
  pw: { marginTop: 10, minHeight: 50, borderRadius: 12, backgroundColor: '#161D2E', borderWidth: 2, borderColor: '#2A3350', padding: 12, justifyContent: 'center' },
  pwText: { color: '#FFFFFF', fontFamily: 'JetBrainsMono_700Bold', fontSize: 16 },
  meterTrack: { height: 12, borderRadius: 6, backgroundColor: '#161D2E', overflow: 'hidden', marginTop: 6 },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  word: { minHeight: 42, borderRadius: 12, borderWidth: 2, borderColor: '#4ADE80', paddingHorizontal: 14, justifyContent: 'center' },
  wordText: { color: '#E9FFF0', fontFamily: F.head, fontSize: 14 },
  ghost: { flex: 1, minHeight: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
