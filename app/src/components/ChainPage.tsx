import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { chainLink } from '../lib/actions';
import { fetchGames, type Game, markGamePlayed } from '../lib/extras';
import { readyFor } from '../lib/readyGames';
import type { ChainStep, Story } from '../lib/types';
import { F, FS } from '../theme';
import { Defender } from './Defender';
import { ErrorBoundary } from './ErrorBoundary';
import { GameCard } from './Games';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * The attack chain page: what happened, told from the story itself.
 * Dark themes get the Bento breakdown (glass tiles), light themes the Editorial explainer (a quality
 * newspaper's graphics page). Both are one page; tap a step for the detail and what would have stopped it.
 * The extra words (headline, damage numbers, step titles, lesson, defender moves) come from the server's
 * explainer; when a story has none yet, plain wording is used instead, so every chain still works.
 */
type Props = { story: Story; s: number; dark: boolean; onBack: () => void; renderGroup?: () => ReactNode };

// plain names for the MITRE ATT&CK stages
export const KICKER: Record<string, string> = {
  Reconnaissance: 'RESEARCH', 'Resource Development': 'PREPARATION', 'Initial Access': 'GETTING IN', Execution: 'RUNNING CODE',
  Persistence: 'STAYING IN', 'Privilege Escalation': 'BECOMING ADMIN', Stealth: 'HIDING', 'Defense Impairment': 'SWITCHING OFF DEFENCES',
  'Credential Access': 'STEALING PASSWORDS', Discovery: 'LOOKING AROUND', 'Lateral Movement': 'SPREADING', Collection: 'GATHERING DATA',
  'Command and Control': 'REMOTE CONTROL', Exfiltration: 'TAKING THE DATA', Impact: 'THE DAMAGE',
};
const ICON: Record<string, IconName> = {
  Reconnaissance: 'account-search-outline', 'Resource Development': 'hammer-wrench', 'Initial Access': 'door-open', Execution: 'console',
  Persistence: 'anchor', 'Privilege Escalation': 'account-arrow-up-outline', Stealth: 'incognito', 'Defense Impairment': 'shield-off-outline',
  'Credential Access': 'key-chain-variant', Discovery: 'radar', 'Lateral Movement': 'lan', Collection: 'folder-zip-outline',
  'Command and Control': 'access-point-network', Exfiltration: 'cloud-upload-outline', Impact: 'lock-alert-outline',
};
// what would have stopped each kind of step, when the server hasn't written a story-specific one
const STOP: Record<string, string> = {
  Reconnaissance: 'Share less about staff, systems and suppliers in public, and teach staff that attackers research them first.',
  'Resource Development': 'Watch for lookalike web addresses and fake sites that copy your brand.',
  'Initial Access': 'Patch quickly, use phishing-proof sign-in, and check every unusual request on a number you already have.',
  Execution: 'Only let approved programs run on work computers.',
  Persistence: 'Get an alert for new admin accounts, scheduled tasks and remote access tools.',
  'Privilege Escalation': 'Give admin rights to as few people as possible, and only when needed.',
  Stealth: 'Keep logs somewhere attackers cannot delete them.',
  'Defense Impairment': 'Get an alert the moment antivirus or logging is switched off.',
  'Credential Access': 'Use passkeys, and get an alert when password files are copied.',
  Discovery: 'Flag unusual scanning and lookups inside the network.',
  'Lateral Movement': 'Split the network into sections, and give admins separate accounts.',
  Collection: 'Limit who can reach sensitive files.',
  'Command and Control': 'Block and alert on traffic to unknown servers.',
  Exfiltration: 'Watch for large uploads, and limit where data can be sent.',
  Impact: 'Keep offline backups and practise restoring them.',
};
const GAME_NAME: Record<string, string> = {
  scam_or_legit: 'Scam or legit?', patch_or_panic: 'Patch or panic', red_flags: 'Spot the red flags', real_link: 'Which link is real?',
  order_steps: 'What do you do first?', crack_meter: 'Crack-o-meter', hot_seat: 'Help desk hot seat', approve: "Don't tap Approve",
  home: 'Lock up your digital home', overshare: 'Overshare detective',
};
const kicker = (st: ChainStep) => KICKER[st.stage] ?? st.stage.toUpperCase();
const plainTitle = (st: ChainStep) => {
  const k = (KICKER[st.stage] ?? st.stage).toLowerCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
};
const icon = (st: ChainStep): IconName => ICON[st.stage] ?? 'shield-outline';
const open = (url?: string | null) => url && Linking.openURL(url).catch(() => {});
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function useRise(delay: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 520, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay]);
  return { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] };
}
function Rise({ delay, style, children }: { delay: number; style?: object; children: ReactNode }) {
  const a = useRise(delay);
  return <Animated.View style={[style, a]}>{children}</Animated.View>;
}
function usePulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [v]);
  return { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] };
}

export function ChainPage({ story, s, dark, onBack, renderGroup }: Props) {
  const steps = story.attack_chain ?? [];
  const inc = story.incident ?? {};
  const ex = inc.explainer;
  const n = steps.length;
  // where they got in: the first "Initial Access" step (else the first step)
  const entryIdx = Math.max(0, steps.findIndex((st) => st.stage === 'Initial Access'));
  const [sheet, setSheet] = useState<number | 'group' | null>(null);
  const [playing, setPlaying] = useState(false);
  // the story's own game (or, if it has none, the everyday game that fits it best)
  const [game, setGame] = useState<{ g: Game; headline: string; own: boolean } | null>(null);
  const [gameOpen, setGameOpen] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    let live = true;
    const fallback = readyFor(story);
    fetchGames([story.id]).then((list) => {
      if (!live) return;
      const own = list[0];
      setGame(own ? { g: own, headline: story.headline, own: true } : { g: fallback, headline: fallback.headline, own: false });
    });
    return () => {
      live = false;
    };
  }, [story.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = new Date(story.published_at);
  const when = isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const info = {
    title: ex?.title || 'How the attack worked',
    // no server title yet: the plain name of the stage ("Getting in"), with the step's own sentence below it
    stepTitle: (i: number) => ex?.steps[i]?.title || plainTitle(steps[i]),
    stop: (i: number) => ex?.steps[i]?.stop || STOP[steps[i].stage] || 'Spot it early and shut it down.',
    lesson: ex?.lesson || STOP[steps[entryIdx]?.stage] || '',
    impact: ex?.impact ?? [],
    target: [inc.victim, inc.victim_country].filter(Boolean).join(', '),
    attacker: inc.actor || '',
    when,
    canPlay: !!ex && ex.defend.length > 0,
    hasEx: !!ex,
  };
  const P = dark ? DARK : LIGHT;
  const Body = dark ? Bento : Editorial;

  return (
    <View style={{ flex: 1, backgroundColor: P.bg }}>
      {dark && <LinearGradient colors={['rgba(255,77,94,0.16)', 'rgba(7,8,13,0)']} start={{ x: 1, y: 0 }} end={{ x: 0.3, y: 0.5 }} style={StyleSheet.absoluteFill} />}
      <Pressable onPress={onBack} style={[styles.top, !dark && { borderBottomWidth: 1, borderBottomColor: P.line }]} hitSlop={10} accessibilityLabel="Back to the story">
        <View style={[styles.back, { backgroundColor: P.chip, borderColor: P.chipBorder }]}>
          <MaterialCommunityIcons name="chevron-left" size={20 * s} color={P.text} />
        </View>
        <Text style={{ flex: 1, color: P.muted, fontFamily: F.label, fontSize: 12.5 * s }}>Story</Text>
        <Text style={{ color: P.muted, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.6 }}>{dark ? 'HOW IT HAPPENED' : 'CYBERSID EXPLAINER'}</Text>
      </Pressable>
      {/* no nestedScrollEnabled: on Android it passed the end of this scroll on to the news feed behind */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14 * s, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        <Body story={story} s={s} info={info} entryIdx={entryIdx} onOpen={setSheet} hasGroup={!!story.actor_group && !!renderGroup} />
        <Text style={{ color: P.faint, fontFamily: F.body, fontSize: 11 * s, lineHeight: 16 * s, marginTop: 16 * s }}>
          {inc.researched && inc.sources?.length ? `Steps from the article and trusted reports (${inc.sources.join(', ')}). ` : ''}Stages follow MITRE ATT&CK. Countries are only shown when officially stated.
        </Text>
      </ScrollView>

      {/* the games for this story, always in reach at the bottom */}
      {(info.canPlay || game) && (
        <View style={[styles.bar, { backgroundColor: P.bg, borderTopColor: P.line }]}>
          {info.canPlay && (
            <Pressable onPress={() => setPlaying(true)} style={[styles.barBtn, { backgroundColor: dark ? '#4ADE80' : LIGHT.text }]} accessibilityRole="button" accessibilityLabel="Play defender">
              <MaterialCommunityIcons name="shield-sword" size={18 * s} color={dark ? '#07080D' : LIGHT.bg} />
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: dark ? '#07080D' : LIGHT.bg, fontFamily: F.head, fontSize: 13 * s, lineHeight: 16 * s }} numberOfLines={2}>Play defender</Text>
                <Text style={{ color: dark ? 'rgba(7,8,13,0.7)' : 'rgba(250,247,241,0.75)', fontFamily: F.medium, fontSize: 10.5 * s }} numberOfLines={1}>Could you stop it?</Text>
              </View>
            </Pressable>
          )}
          {game && (
            <Pressable
              onPress={() => {
                if (game.own) markGamePlayed(game.g.id);
                setGameOpen(true);
              }}
              style={[styles.barBtn, { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : '#FFFFFF', borderWidth: 1, borderColor: dark ? 'rgba(255,255,255,0.16)' : LIGHT.chipBorder }]}
              accessibilityRole="button"
              accessibilityLabel={`Play ${GAME_NAME[game.g.style] ?? 'the game'}`}
            >
              <MaterialCommunityIcons name="gamepad-variant" size={18 * s} color={P.text} />
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: P.text, fontFamily: F.head, fontSize: 13 * s, lineHeight: 16 * s }} numberOfLines={2}>{GAME_NAME[game.g.style] ?? 'Play the game'}</Text>
                <Text style={{ color: P.muted, fontFamily: F.medium, fontSize: 10.5 * s }} numberOfLines={1}>{game.own ? 'Game on this story' : 'Try it yourself'}</Text>
              </View>
            </Pressable>
          )}
        </View>
      )}

      {sheet !== null && (
        <Sheet dark={dark} onClose={() => setSheet(null)}>
          {sheet === 'group' ? (
            renderGroup?.()
          ) : (
            <StepDetail story={story} i={sheet} s={s} dark={dark} title={info.stepTitle(sheet)} stop={info.stop(sheet)} entry={sheet === entryIdx} />
          )}
        </Sheet>
      )}
      {playing && ex && (
        <Defender story={story} explainer={ex} dark={dark} s={s} onClose={() => setPlaying(false)} />
      )}
      {gameOpen && game && (
        <View key="game" style={[StyleSheet.absoluteFill, { backgroundColor: P.bg }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <Pressable onPress={() => setGameOpen(false)} style={styles.top} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to the chain">
            <View style={[styles.back, { backgroundColor: P.chip, borderColor: P.chipBorder }]}>
              <MaterialCommunityIcons name="chevron-left" size={20 * s} color={P.text} />
            </View>
            <Text style={{ flex: 1, color: P.muted, fontFamily: F.label, fontSize: 12.5 * s }}>Attack chain</Text>
          </Pressable>
          {box.h > 0 && (
            <View style={{ alignItems: 'center' }}>
              <ErrorBoundary resetKey={game.g.id} fallback={() => <Text style={{ color: P.muted, fontFamily: F.body, fontSize: 13, padding: 24, textAlign: 'center' }}>Sorry, this game didn't load.</Text>}>
                <GameCard game={game.g} headline={game.headline} width={box.w - 16} height={box.h - 60} active foot="Finish to earn XP" />
              </ErrorBoundary>
            </View>
          )}
        </View>
      )}
      {n === 0 && null}
    </View>
  );
}

type Info = {
  title: string; stepTitle: (i: number) => string; stop: (i: number) => string; lesson: string;
  impact: { value: string; label: string }[]; target: string; attacker: string; when: string; canPlay: boolean; hasEx: boolean;
};
type BodyProps = { story: Story; s: number; info: Info; entryIdx: number; onOpen: (k: number | 'group') => void; hasGroup: boolean };

const DARK = { bg: '#07080D', text: '#F5F6FA', muted: 'rgba(245,246,250,0.55)', faint: 'rgba(245,246,250,0.35)', chip: 'rgba(255,255,255,0.07)', chipBorder: 'rgba(255,255,255,0.1)', line: 'rgba(255,255,255,0.1)', red: '#FF4D5E', green: '#4ADE80' };
const LIGHT = { bg: '#FAF7F1', text: '#1A1612', muted: '#6B6257', faint: '#9A9083', chip: '#FFFFFF', chipBorder: '#E6DFD3', line: '#E6DFD3', red: '#C2261C', green: '#1F7A4D' };

// ------------------------------------------------------------------------------------------------
// Bento breakdown (dark themes)
// ------------------------------------------------------------------------------------------------
function Bento({ story, s, info, entryIdx, onOpen, hasGroup }: BodyProps) {
  const steps = story.attack_chain ?? [];
  const last = steps.length - 1;
  // the damage tile: the Impact step if there is one, else the last step
  const impactAt = steps.map((st) => st.stage).lastIndexOf('Impact');
  const damageIdx = impactAt > 0 && impactAt !== entryIdx ? impactAt : last > 0 && last !== entryIdx ? last : -1;
  // tiles: the entry point and the damage are wide; the others pair up two to a row
  type Tile = { i: number; kind: 'hero' | 'damage' | 'small'; wide: boolean };
  const tiles: Tile[] = steps.map((_, i) => ({ i, kind: i === entryIdx ? 'hero' : i === damageIdx ? 'damage' : 'small', wide: i === entryIdx || i === damageIdx }));
  // a small tile with no partner beside it becomes wide
  for (let k = 0; k < tiles.length; k++) {
    if (tiles[k].wide) continue;
    const next = tiles[k + 1];
    if (!next || next.wide) tiles[k].wide = true;
    else k++;
  }
  return (
    <View>
      <Rise delay={0}>
        <Text style={{ color: DARK.red, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.6, marginTop: 6 }}>ATTACK BREAKDOWN · {story.category.toUpperCase()}</Text>
        <Text style={{ color: DARK.text, fontFamily: F.brand, fontSize: 22 * s, lineHeight: 26 * s, letterSpacing: -0.6, marginTop: 6 }}>{info.title}</Text>
        <View style={styles.chips}>
          {!!info.target && <Chip dot="#60A5FA" text={`Target · ${info.target}`} s={s} />}
          {!!info.attacker && <Chip dot={DARK.red} text={info.attacker} s={s} onPress={hasGroup ? () => onOpen('group') : undefined} />}
          {!!info.when && <Chip dot="#A3A3A3" text={info.when} s={s} />}
        </View>
      </Rise>
      <View style={styles.grid}>
        {tiles.map((t, k) => {
          const st = steps[t.i];
          const num = `${String(t.i + 1).padStart(2, '0')} · ${kicker(st)}`;
          const delay = 120 + k * 90;
          if (t.kind === 'hero') {
            return (
              <Rise key={t.i} delay={delay} style={{ width: '100%' }}>
                <Pressable onPress={() => onOpen(t.i)} style={[styles.tile, { borderColor: 'rgba(255,77,94,0.5)', overflow: 'hidden' }]} accessibilityRole="button">
                  <LinearGradient colors={['rgba(255,77,94,0.28)', 'rgba(255,77,94,0.04)']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 1 }} style={StyleSheet.absoluteFill} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={[styles.tileKicker, { color: '#FF8A95', fontSize: 10.5 * s }]}>{num}</Text>
                    <EntryBadge s={s} />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 }}>
                    <View style={[styles.heroIcon, { width: 58 * s, height: 58 * s, borderRadius: 18 * s }]}>
                      <MaterialCommunityIcons name={icon(st)} size={30 * s} color="#FFFFFF" />
                    </View>
                    <Text style={{ flex: 1, color: DARK.text, fontFamily: F.head, fontSize: 17 * s, lineHeight: 22 * s }}>{info.stepTitle(t.i)}</Text>
                  </View>
                  <Text style={{ color: 'rgba(245,246,250,0.72)', fontFamily: F.body, fontSize: 13.5 * s, lineHeight: 19 * s, marginTop: 10 }}>{st.detail}</Text>
                </Pressable>
              </Rise>
            );
          }
          if (t.kind === 'damage') {
            return (
              <Rise key={t.i} delay={delay} style={{ width: '100%' }}>
                <Pressable onPress={() => onOpen(t.i)} style={[styles.tile, { borderColor: 'rgba(255,77,94,0.35)', overflow: 'hidden' }]} accessibilityRole="button">
                  <LinearGradient colors={['#2A0B12', '#12060A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <Text style={[styles.tileKicker, { color: '#FF8A95', fontSize: 10.5 * s }]}>{num}</Text>
                  <Text style={{ color: DARK.text, fontFamily: F.head, fontSize: 16 * s, lineHeight: 21 * s, marginTop: 6 }}>{info.stepTitle(t.i)}</Text>
                  {info.impact.length > 0 ? (
                    <View style={{ flexDirection: 'row', gap: 22, marginTop: 10 }}>
                      {info.impact.map((m, j) => (
                        <Rise key={j} delay={delay + 380 + j * 180}>
                          <Text style={{ color: j === 1 ? DARK.red : DARK.text, fontFamily: F.brand, fontSize: 30 * s, lineHeight: 34 * s, letterSpacing: -1 }}>{m.value}</Text>
                          <Text style={{ color: DARK.muted, fontFamily: F.body, fontSize: 11.5 * s }}>{m.label}</Text>
                        </Rise>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ color: 'rgba(245,246,250,0.72)', fontFamily: F.body, fontSize: 13.5 * s, lineHeight: 19 * s, marginTop: 6 }}>{st.detail}</Text>
                  )}
                </Pressable>
              </Rise>
            );
          }
          return (
            <Rise key={t.i} delay={delay} style={{ width: t.wide ? '100%' : '48.6%' }}>
              <Pressable onPress={() => onOpen(t.i)} style={[styles.tile, { minHeight: 104 * s, backgroundColor: 'rgba(255,255,255,0.05)' }]} accessibilityRole="button">
                <Text style={[styles.tileKicker, { color: DARK.muted, fontSize: 9.5 * s, lineHeight: 13 * s }]}>{num}</Text>
                <Text style={{ color: DARK.text, fontFamily: F.head, fontSize: 14 * s, lineHeight: 18 * s, marginTop: 6, paddingRight: t.wide ? 48 : 0, marginBottom: 30 }}>{info.hasEx ? info.stepTitle(t.i) : st.detail}</Text>
                <View style={[styles.smallIcon, { right: 10, bottom: 10 }]}>
                  <MaterialCommunityIcons name={icon(st)} size={18 * s} color="#C4B5FD" />
                </View>
              </Pressable>
            </Rise>
          );
        })}
        <Rise delay={120 + tiles.length * 90} style={{ width: '100%' }}>
          <View style={[styles.tile, { borderColor: 'rgba(74,222,128,0.35)', overflow: 'hidden' }]}>
            <LinearGradient colors={['rgba(74,222,128,0.16)', 'rgba(74,222,128,0.03)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={[styles.tileKicker, { color: DARK.green, fontSize: 10.5 * s }]}>THE MOVE THAT STOPS IT</Text>
            <Text style={{ color: DARK.text, fontFamily: F.head, fontSize: 15 * s, lineHeight: 20 * s, marginTop: 5 }}>{info.lesson}</Text>
          </View>
        </Rise>
      </View>
    </View>
  );
}

function Chip({ dot, text, s, onPress }: { dot: string; text: string; s: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.chip, { backgroundColor: DARK.chip, borderColor: DARK.chipBorder }]} hitSlop={4}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
      <Text style={{ color: DARK.text, fontFamily: F.label, fontSize: 11.5 * s }} numberOfLines={1}>{text}</Text>
      {!!onPress && <MaterialCommunityIcons name="information-outline" size={13 * s} color={DARK.muted} />}
    </Pressable>
  );
}

function EntryBadge({ s }: { s: number }) {
  const p = usePulse();
  return (
    <View>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 999, backgroundColor: '#FF4D5E' }, p]} />
      <View style={{ backgroundColor: '#FF4D5E', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
        <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 9.5 * s, letterSpacing: 1.2 }}>ENTRY POINT</Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Editorial explainer (light themes)
// ------------------------------------------------------------------------------------------------
function whenLabel(i: number, n: number) {
  if (i === 0) return 'FIRST';
  if (i === n - 1) return 'FINALLY';
  return ['THEN', 'NEXT', 'AFTER THAT'][(i - 1) % 3];
}

function Editorial({ story, s, info, entryIdx, onOpen, hasGroup }: BodyProps) {
  const steps = story.attack_chain ?? [];
  const n = steps.length;
  const impactAt = steps.map((st) => st.stage).lastIndexOf('Impact');
  const damageIdx = impactAt > 0 && impactAt !== entryIdx ? impactAt : n > 1 && n - 1 !== entryIdx ? n - 1 : -1;
  const grow = useRef(new Animated.Value(0)).current;
  const [lineH, setLineH] = useState(0);
  useEffect(() => {
    Animated.timing(grow, { toValue: 1, duration: 1400, delay: 300, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start();
  }, [grow]);
  return (
    <View style={{ paddingHorizontal: 6 }}>
      <Rise delay={0}>
        <Text style={{ color: LIGHT.red, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 2, marginTop: 10 }}>HOW IT HAPPENED</Text>
        <Text style={{ color: LIGHT.text, fontFamily: FS.display, fontSize: 28 * s, lineHeight: 33 * s, marginTop: 6 }}>{info.title}</Text>
        <Text style={{ color: '#4A433B', fontFamily: F.body, fontSize: 14 * s, lineHeight: 20 * s, marginTop: 8 }}>{story.headline}</Text>
        <Text style={{ color: LIGHT.faint, fontFamily: F.body, fontSize: 11.5 * s, marginTop: 8 }}>
          {[info.target && `Target: ${info.target}`, info.when, `${n} steps`, 'Tap any step'].filter(Boolean).join(' · ')}
        </Text>
        {!!info.attacker && (
          <Pressable onPress={hasGroup ? () => onOpen('group') : undefined} disabled={!hasGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Text style={{ color: LIGHT.text, fontFamily: F.head, fontSize: 12.5 * s }}>Attacker: {info.attacker}</Text>
            {hasGroup && <MaterialCommunityIcons name="information-outline" size={14 * s} color={LIGHT.muted} />}
          </Pressable>
        )}
      </Rise>

      <View style={{ marginTop: 18 }} onLayout={(e) => setLineH(e.nativeEvent.layout.height)}>
        <View style={[styles.rule, { left: 74 * s - 1, height: Math.max(0, lineH - 30), backgroundColor: LIGHT.line }]} />
        <Animated.View style={[styles.rule, { left: 74 * s - 1, height: Math.max(0, lineH - 30), backgroundColor: LIGHT.text, transformOrigin: 'top', transform: [{ scaleY: grow }] }]} />
        {steps.map((st, i) => {
          const entry = i === entryIdx, final = i === damageIdx, hot = entry || final;
          return (
            <Rise key={i} delay={300 + i * 200}>
              <Pressable onPress={() => onOpen(i)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: 'rgba(26,22,18,0.04)' }]} accessibilityRole="button">
                <Text style={{ width: 68 * s, color: hot ? LIGHT.red : LIGHT.faint, fontFamily: F.head, fontSize: 9.5 * s, letterSpacing: 1.3, marginTop: 3 }}>{whenLabel(i, n)}</Text>
                <View style={{ width: 12 * s, alignItems: 'center' }}>
                  {entry && <Pulse />}
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: hot ? LIGHT.red : LIGHT.text, borderWidth: 2, borderColor: LIGHT.bg, marginTop: 2 }} />
                </View>
                <View style={{ flex: 1, paddingLeft: 12 }}>
                  {entry && (
                    <View style={{ alignSelf: 'flex-start', backgroundColor: LIGHT.red, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2, marginBottom: 4 }}>
                      <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 9 * s, letterSpacing: 1.3 }}>ENTRY POINT</Text>
                    </View>
                  )}
                  <Text style={{ color: LIGHT.text, fontFamily: FS.serifBold, fontSize: 15.5 * s, lineHeight: 21 * s }}>{info.stepTitle(i)}</Text>
                  <Text style={{ color: '#5A5248', fontFamily: F.body, fontSize: 13 * s, lineHeight: 18 * s, marginTop: 3 }}>{st.detail}</Text>
                  {final && info.impact.length > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: LIGHT.red, fontFamily: FS.display, fontSize: 38 * s, lineHeight: 44 * s }}>{info.impact[0].value}</Text>
                      <Text style={{ color: LIGHT.muted, fontFamily: F.body, fontSize: 11.5 * s, lineHeight: 15 * s, marginBottom: 6, flexShrink: 1 }}>
                        {info.impact.map((m, j) => (j === 0 ? m.label : `${m.value} ${m.label}`)).join('\n')}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            </Rise>
          );
        })}
      </View>

      <Rise delay={400 + n * 200} style={{ borderTopWidth: 2, borderTopColor: LIGHT.text, paddingTop: 10, marginTop: 14 }}>
        <Text style={{ color: LIGHT.green, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 2 }}>THE LESSON</Text>
        <Text style={{ color: LIGHT.text, fontFamily: FS.serifItalic, fontSize: 16 * s, lineHeight: 24 * s, marginTop: 4 }}>"{info.lesson}"</Text>
      </Rise>
    </View>
  );
}

function Pulse() {
  const p = usePulse();
  return <Animated.View style={[{ position: 'absolute', top: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: LIGHT.red }, p]} />;
}

// ------------------------------------------------------------------------------------------------
// The step detail sheet (both looks)
// ------------------------------------------------------------------------------------------------
function Sheet({ dark, onClose, children }: { dark: boolean; onClose: () => void; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? 'rgba(0,0,0,0.6)' : 'rgba(26,22,18,0.4)', opacity: v }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { backgroundColor: dark ? '#12131A' : '#FFFDF8', transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }] }]}>
        <View style={[styles.grab, { backgroundColor: dark ? 'rgba(255,255,255,0.25)' : '#D8CFC1' }]} />
        <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
}

function StepDetail({ story, i, s, dark, title, stop, entry }: { story: Story; i: number; s: number; dark: boolean; title: string; stop: string; entry: boolean }) {
  const st = (story.attack_chain ?? [])[i];
  if (!st) return null;
  const P = dark ? DARK : LIGHT;
  const mitre = chainLink(st);
  const fromArticle = !st.source || st.source === 'article';
  return (
    <View>
      <Text style={{ color: entry ? P.red : P.muted, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.4 }}>
        STEP {i + 1} · {kicker(st)}{entry ? ' · ENTRY POINT' : ''}
      </Text>
      <Text style={{ color: P.text, fontFamily: dark ? F.brand : FS.serifBold, fontSize: 20 * s, lineHeight: 26 * s, marginTop: 6 }}>{title}</Text>
      <Text style={{ color: dark ? 'rgba(245,246,250,0.78)' : '#4A433B', fontFamily: F.body, fontSize: 14.5 * s, lineHeight: 22 * s, marginTop: 8 }}>{st.detail}</Text>
      <View style={[styles.stopBox, { backgroundColor: dark ? 'rgba(74,222,128,0.1)' : '#EEF6F0', borderColor: dark ? 'rgba(74,222,128,0.3)' : P.green }]}>
        <Text style={{ color: P.green, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.3 }}>WHAT WOULD HAVE STOPPED THIS STEP</Text>
        <Text style={{ color: P.text, fontFamily: F.body, fontSize: 14 * s, lineHeight: 20 * s, marginTop: 4 }}>{stop}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
        {!!mitre && (
          <Pressable onPress={() => open(mitre)} hitSlop={8}>
            <Text style={{ color: P.muted, fontFamily: F.medium, fontSize: 12 * s }}>MITRE ATT&CK {st.technique || st.tactic} ↗</Text>
          </Pressable>
        )}
        <Pressable onPress={() => open(fromArticle ? story.url : st.source_url)} hitSlop={8}>
          <Text style={{ color: P.muted, fontFamily: F.medium, fontSize: 12 * s }}>Source: {fromArticle ? story.source : st.source} ↗</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 },
  back: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, maxWidth: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 14 },
  tile: { borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', padding: 14 },
  tileKicker: { fontFamily: F.head, letterSpacing: 1.3 },
  heroIcon: { backgroundColor: 'rgba(255,77,94,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  smallIcon: { position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(167,139,250,0.14)', alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1 },
  barBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  rule: { position: 'absolute', top: 8, width: 2 },
  row: { flexDirection: 'row', paddingVertical: 8, borderRadius: 10 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: 28 },
  grab: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  stopBox: { marginTop: 14, padding: 12, borderRadius: 14, borderWidth: 1 },
});
