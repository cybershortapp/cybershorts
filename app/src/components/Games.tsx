import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { Game } from '../lib/extras';
import { buzz } from '../lib/buzz';
import { recordResult } from '../lib/progress';
import { F } from '../theme';
import { Fit } from './Fit';
import { type Finish, GAME_SECONDS, type Hud, HudContext, INK, LIVES, TopBar, useHud, type WinInfo, WinScreen } from './GameKit';
import { Approve, HotSeat, Overshare } from './GamesPlus';
import { FlagMail, HouseLock, LinkCheck, linkTitle, ScamSwipe, StepSlots, VaultCrack } from './GamesVisual';
import { XpPop } from './XpPop';

type GameProps = { game: Game; active: boolean; image?: string | null };
type Style = Game['style'];

const NAMES: Record<Style, string> = {
  scam_or_legit: 'Scam or legit',
  patch_or_panic: 'Patch or panic',
  red_flags: 'Red flags',
  real_link: 'Real link',
  order_steps: 'First steps',
  crack_meter: 'Crack-o-meter',
  hot_seat: 'Help desk',
  approve: "Don't approve",
  home: 'Digital home',
  overshare: 'Overshare',
};

const TITLES: Record<Style, string> = {
  scam_or_legit: 'Scam or legit?\nSwipe the text.',
  patch_or_panic: 'Patch or panic',
  red_flags: 'Tap the red flags',
  real_link: 'Which link is real?',
  order_steps: 'Your data leaked.\nWhat do you do first?',
  crack_meter: "Build a password\nthe hacker can't crack",
  hot_seat: 'Help desk hot seat',
  approve: "Don't tap Approve",
  home: 'Lock up your\ndigital home',
  overshare: 'Overshare detective',
};

/**
 * How each game looks. `kit` games use the shared top bar (timer, hearts, rounds) and win screen;
 * the three story games (help desk, approve, overshare) keep their own flow.
 */
const LOOK: Record<Style, { bg: [string, string]; ink: string; sub: string; chip: string; kicker: string; kit: boolean; hearts: boolean }> = {
  scam_or_legit: { bg: ['#FFF3E8', '#FFE3EC'], ink: INK, sub: 'rgba(21,23,43,0.6)', chip: 'rgba(255,255,255,0.8)', kicker: '#E8590C', kit: true, hearts: true },
  real_link: { bg: ['#EAF2FF', '#F3ECFF'], ink: INK, sub: 'rgba(21,23,43,0.6)', chip: 'rgba(255,255,255,0.8)', kicker: '#6A3DF0', kit: true, hearts: true },
  red_flags: { bg: ['#E6F4FF', '#F4F9FF'], ink: INK, sub: 'rgba(21,23,43,0.6)', chip: 'rgba(255,255,255,0.85)', kicker: '#E5243B', kit: true, hearts: true },
  home: { bg: ['#F3EEFF', '#FFF0F7'], ink: INK, sub: 'rgba(21,23,43,0.6)', chip: 'rgba(255,255,255,0.8)', kicker: '#6A3DF0', kit: true, hearts: true },
  order_steps: { bg: ['#E8FAF2', '#F2FBFF'], ink: INK, sub: 'rgba(21,23,43,0.6)', chip: 'rgba(255,255,255,0.8)', kicker: '#0E9F6E', kit: true, hearts: true },
  crack_meter: { bg: ['#E6FAF7', '#EAF2FF'], ink: INK, sub: 'rgba(21,23,43,0.6)', chip: 'rgba(255,255,255,0.8)', kicker: '#0E7C86', kit: true, hearts: false },
  patch_or_panic: { bg: ['#1B1F4B', '#0E1130'], ink: '#FFFFFF', sub: 'rgba(255,255,255,0.6)', chip: 'rgba(255,255,255,0.12)', kicker: '#FDE68A', kit: true, hearts: true },
  hot_seat: { bg: ['#0D1325', '#0A0F1E'], ink: '#FFFFFF', sub: 'rgba(255,255,255,0.6)', chip: 'rgba(255,255,255,0.12)', kicker: '#7DD3FC', kit: false, hearts: false },
  approve: { bg: ['#120B2E', '#0B0720'], ink: '#FFFFFF', sub: 'rgba(255,255,255,0.6)', chip: 'rgba(255,255,255,0.12)', kicker: '#F0ABFC', kit: false, hearts: false },
  overshare: { bg: ['#F8FAFC', '#EEF2F7'], ink: '#0F172A', sub: '#64748B', chip: 'rgba(255,255,255,0.9)', kicker: '#B45309', kit: false, hearts: false },
};

/** The most XP a game can give, shown in the top bar so there's something to play for. */
function maxXp(g: Game) {
  const d = g.data ?? {};
  switch (g.style) {
    case 'scam_or_legit': return 40 * (d.items?.length ?? 4);
    case 'patch_or_panic': return 50 * (d.questions?.length ?? 3);
    case 'home': return 30 * (d.rounds?.length ?? 5) + 30;
    case 'red_flags':
    case 'order_steps': return 120;
    case 'hot_seat': return 300;
    case 'approve': return 200;
    case 'overshare': return 40 * (1 + (d.posts?.filter?.((p: { risky?: boolean }) => p.risky).length ?? 4));
    default: return 100;
  }
}

/** A game card: in the feed after its story, inside an attack chain, or in the Play section. */
export function GameCard({ game, headline, width, height, active, foot, image, onDone, doneLabel }: {
  game: Game; headline: string; width: number; height: number; active: boolean; foot?: string;
  image?: string | null; onDone?: () => void; doneLabel?: string;
}) {
  const Body = {
    scam_or_legit: ScamSwipe, patch_or_panic: PatchOrPanic, red_flags: FlagMail, real_link: LinkCheck, order_steps: StepSlots,
    crack_meter: VaultCrack, hot_seat: HotSeat, approve: Approve, home: HouseLock, overshare: Overshare,
  }[game.style];
  const look = LOOK[game.style];
  const [run, setRun] = useState(0);
  const [lives, setLives] = useState(LIVES);
  const [prog, setProg] = useState({ done: 0, total: 1 });
  const [secs, setSecs] = useState(GAME_SECONDS);
  const [win, setWin] = useState<WinInfo | null>(null);
  const progRef = useRef(prog);
  progRef.current = prog;
  const livesRef = useRef(lives);
  livesRef.current = lives;
  const startedAt = useRef(0);
  const over = useRef(false);

  // the 30-second ring counts down while the game is on screen (only a nudge: you can still finish after)
  useEffect(() => {
    if (!active || win || !look?.kit) return;
    if (!startedAt.current) startedAt.current = Date.now();
    const id = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [active, win, run, look?.kit]);

  const finish = useCallback((f: Finish) => {
    if (over.current) return;
    over.current = true;
    const res = recordResult({ game: game.style, won: f.won, xp: f.xp, badge: f.won ? f.badge : undefined });
    const took = startedAt.current ? Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)) : GAME_SECONDS - secs;
    setWin({ ...f, name: NAMES[game.style], gotXp: res.xp, newBadge: res.newBadge, perfect: f.won && f.score === f.total && livesRef.current === LIVES, secs: took });
  }, [game.style, secs]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  const hud = useMemo<Hud>(() => ({
    step: (done, total) => setProg({ done, total: Math.max(1, total) }),
    miss: () =>
      setLives((l) => {
        const left = Math.max(0, l - 1);
        if (left === 0 && LOOK[game.style].hearts) {
          // out of hearts: the round ends here
          setTimeout(() => {
            const p = progRef.current;
            finishRef.current({ won: false, score: Math.min(p.done, p.total), total: p.total, xp: Math.min(p.done, p.total) * 10 });
          }, 1100);
        }
        return left;
      }),
    finish: (f) => finishRef.current(f),
  }), [game.style]);

  const again = () => {
    over.current = false;
    startedAt.current = 0;
    setWin(null);
    setLives(LIVES);
    setSecs(GAME_SECONDS);
    setProg({ done: 0, total: 1 });
    setRun((r) => r + 1);
  };

  if (!Body || !look) return null;
  const title = game.style === 'real_link' ? linkTitle(game.data?.ask) : game.style === 'red_flags' ? `Tap the ${(game.data?.lines ?? []).filter((l: { flag?: boolean }) => l?.flag).length || 4} red flags` : TITLES[game.style];
  const hint = foot ?? (look.kit && secs === 0 && !win ? "Time's up, but you can still finish" : 'Swipe up to skip · Turn games off in Settings');
  // short phones: a smaller heading, so the game itself gets the room
  const compact = height < 640;
  return (
    <View style={{ width, height, borderRadius: 24, overflow: 'hidden' }}>
      <LinearGradient colors={look.bg} start={{ x: 0, y: 0 }} end={{ x: 0.35, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.head, compact && { paddingTop: 12, paddingBottom: 6 }]}>
        {look.kit ? (
          <TopBar seconds={secs} lives={lives} done={prog.done} total={prog.total} xp={maxXp(game)} ink={look.ink} chip={look.chip} hearts={look.hearts} />
        ) : null}
        <Text style={[styles.kicker, { color: look.kicker, marginTop: look.kit ? (compact ? 8 : 12) : 0 }]}>30-SECOND GAME</Text>
        <Text style={[styles.about, { color: look.sub }]} numberOfLines={1}>About: {headline}</Text>
        <Text style={[styles.title, { color: look.ink }, compact && { fontSize: 21, lineHeight: 25, marginTop: 4 }]} numberOfLines={3}>{title}</Text>
      </View>
      <Fit min={0.6}>
        <View style={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 4 }}>
          <HudContext.Provider value={hud}>
            <Body key={run} game={game} active={active && !win} image={image} />
          </HudContext.Provider>
        </View>
      </Fit>
      <Text style={[styles.foot, { color: look.sub }]} numberOfLines={1}>{hint}</Text>
      {!win && !look.kit && <XpPop active={active} />}
      {win && <WinScreen info={win} width={width} height={height} onAgain={again} onDone={onDone} doneLabel={doneLabel} />}
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Patch or panic: answer before the fuse burns down. Right: the bomb is defused. Wrong: boom.
// ------------------------------------------------------------------------------------------------
const FUSE = 12;
/** The same shuffle every time for the same game, so the right answer isn't always first. */
function orderFor(seed: string, n: number) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) | 0;
    const j = Math.abs(h) % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}
function PatchOrPanic({ game, active }: GameProps) {
  const hud = useHud();
  const qs: { q: string; options: string[]; answer: number; why: string }[] = (game.data.questions ?? []).filter((q: { q?: string; options?: string[] }) => q?.q && q.options?.length);
  const [i, setI] = useState(0);
  const [t, setT] = useState(FUSE);
  const [picked, setPicked] = useState<number | null>(null); // -1 = ran out of time
  const [score, setScore] = useState(0);
  const wobble = useRef(new Animated.Value(0)).current;
  const result = picked !== null;
  const right = result && picked === qs[i]?.answer;
  useEffect(() => hud.step(0, qs.length), []); // eslint-disable-line react-hooks/exhaustive-deps

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
        hud.miss();
        return 0;
      }
      return x - 1;
    }), 1000);
    return () => clearInterval(id);
  }, [active, result, i]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = qs[i];
  if (!q) return null;
  const order = orderFor(`${game.id}-${i}`, q.options.length);
  const pick = (k: number) => {
    if (result) return;
    setPicked(k);
    if (k === q.answer) {
      setScore((s) => s + 1);
      buzz.right();
    } else {
      buzz.wrong();
      hud.miss();
    }
    hud.step(i + 1, qs.length);
  };
  const last = i === qs.length - 1;
  const boom = result && !right;

  return (
    <View style={{ flexGrow: 1 }}>
      <View style={styles.fuseTrack}>
        <View style={[styles.fuse, { width: `${result ? (right ? 100 : 0) : (t / FUSE) * 100}%` }]} />
      </View>
      <View style={{ height: 140, alignItems: 'center', justifyContent: 'center' }}>
        {boom ? (
          <Svg width={160} height={126} viewBox="0 0 190 150">
            <Path d="M95 8 L112 48 L156 30 L134 70 L182 84 L136 98 L158 140 L110 116 L95 146 L80 116 L32 140 L54 98 L8 84 L56 70 L34 30 L78 48 Z" fill="#FF8A3D" stroke="#FDE68A" strokeWidth={5} strokeLinejoin="round" />
          </Svg>
        ) : (
          <Animated.View style={{ transform: [{ rotate: wobble.interpolate({ inputRange: [-1, 1], outputRange: [result ? '0deg' : '-4deg', result ? '0deg' : '4deg'] }) }] }}>
            <Svg width={124} height={134} viewBox="0 0 150 160">
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
        {boom && <Text style={styles.boomText}>BOOM</Text>}
      </View>
      <Text style={styles.qCount}>QUESTION {i + 1} OF {qs.length}</Text>
      <Text style={styles.q}>{q.q}</Text>
      <View style={{ gap: 10, marginTop: 12 }}>
        {order.map((k) => {
          const o = q.options[k];
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
            onPress={() => {
              if (last) {
                hud.finish({ won: score >= Math.ceil(qs.length * 0.6), score, total: qs.length, xp: score * 50, badge: score === qs.length ? 'patch_or_panic' : undefined, line: 'Unused, abandoned apps are hidden doors: remove what you no longer use.' });
                return;
              }
              setI(i + 1);
              setPicked(null);
              setT(FUSE);
            }}
            style={styles.yellowBtn}
            accessibilityRole="button"
          >
            <Text style={styles.yellowBtnText}>{last ? 'See my score' : 'Next question'}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10 },
  kicker: { fontFamily: F.brand, fontSize: 11, letterSpacing: 1.4 },
  about: { fontFamily: F.medium, fontSize: 12, marginTop: 3 },
  title: { fontFamily: F.brand, fontSize: 26, lineHeight: 30, letterSpacing: -0.7, marginTop: 6 },
  foot: { textAlign: 'center', fontFamily: F.medium, fontSize: 11.5, paddingTop: 6, paddingBottom: 12 },
  fuseTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  fuse: { height: '100%', backgroundColor: '#FF8A3D' },
  boomText: { position: 'absolute', alignSelf: 'center', color: '#FFFFFF', fontFamily: F.brand, fontSize: 28 },
  qCount: { color: '#FDE68A', fontFamily: F.head, fontSize: 11.5, letterSpacing: 1.2 },
  q: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 19, lineHeight: 25, marginTop: 4 },
  opt: { minHeight: 50, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  optText: { color: '#FFFFFF', fontFamily: F.label, fontSize: 14.5, lineHeight: 20 },
  why: { fontFamily: F.label, fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
  yellowBtn: { minHeight: 46, borderRadius: 23, paddingHorizontal: 22, backgroundColor: '#FDE68A', justifyContent: 'center' },
  yellowBtnText: { color: '#14163A', fontFamily: F.head, fontSize: 14.5 },
});
