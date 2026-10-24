import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Rect } from 'react-native-svg';

import { chainLink } from '../lib/actions';
import type { ChainStep, Story } from '../lib/types';
import { F, FS } from '../theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
export type ChainView = 'auto' | 'list' | 'metro' | 'story' | 'breakin' | 'defend' | 'viking';
export const CHAIN_VIEWS: { id: ChainView; label: string; icon: IconName }[] = [
  { id: 'auto', label: 'Mix', icon: 'shuffle-variant' },
  { id: 'list', label: 'List', icon: 'format-list-bulleted' },
  { id: 'metro', label: 'Metro', icon: 'subway-variant' },
  { id: 'story', label: 'Story', icon: 'play-box-multiple-outline' },
  { id: 'breakin', label: 'Break-in', icon: 'office-building-outline' },
  { id: 'defend', label: 'Defend', icon: 'shield-check-outline' },
  { id: 'viking', label: 'Viking raid', icon: 'sail-boat' },
];

/**
 * Each story's chain gets one design that suits it; stories of the same kind take turns between a few
 * suitable designs, so readers see them all. The same story always opens the same way.
 */
export function viewFor(story: Story): Exclude<ChainView, 'auto'> {
  const steps = story.attack_chain ?? [];
  const has = (stage: string) => steps.some((st) => st.stage === stage);
  const text = `${story.category} ${story.headline}`.toLowerCase();
  let pool: Exclude<ChainView, 'auto'>[];
  if (story.category === 'Ransomware' || /ransom/.test(text)) pool = ['viking', 'breakin', 'metro'];
  else if (story.category === 'Scams' || /phish|scam|social engineer|help desk|vishing|smish/.test(text)) pool = ['metro', 'list'];
  else if (story.category === 'Breaches' || has('Exfiltration') || /breach|leak|stole|stolen/.test(text)) pool = ['breakin', 'viking', 'metro'];
  else if (story.actor_group || /state|apt|espionage|spy/.test(text)) pool = ['viking', 'metro'];
  else pool = ['list', 'metro', 'breakin', 'viking'];
  // Story (tap through) and Defend were dropped: every chain is one page you can read at a glance
  if (steps.length <= 3) pool = pool.filter((v) => v !== 'breakin');
  if (!pool.length) pool = ['metro'];
  let h = 0;
  for (const ch of story.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return pool[Math.abs(h) % pool.length];
}

type Props = { story: Story; steps: ChainStep[]; width: number; height: number; onBack: () => void };

// Plain words for each MITRE ATT&CK stage, what a defender would have done there, and where it happens in the building.
const SHORT: Record<string, string> = {
  Reconnaissance: 'Scouted the target',
  'Resource Development': 'Got their tools ready',
  'Initial Access': 'Got in',
  Execution: 'Ran their code',
  Persistence: 'Kept a way back in',
  'Privilege Escalation': 'Became admin',
  Stealth: 'Hid their tracks',
  'Defense Impairment': 'Turned off security',
  'Credential Access': 'Stole passwords',
  Discovery: 'Looked around',
  'Lateral Movement': 'Spread further',
  Collection: 'Gathered the data',
  'Command and Control': 'Took remote control',
  Exfiltration: 'Took data out',
  Impact: 'Did the damage',
};
const DEFEND: Record<string, string> = {
  Reconnaissance: 'Share less about staff, systems and suppliers in public.',
  'Resource Development': 'Block lookalike domains and new sites that copy your brand.',
  'Initial Access': 'Patch fast, use phishing-proof sign-in, and check every help desk request.',
  Execution: 'Only let approved programs run on work machines.',
  Persistence: 'Alert on new admin accounts, scheduled tasks and remote tools.',
  'Privilege Escalation': 'Keep admin rights to a few people, only when needed.',
  Stealth: 'Keep logs somewhere attackers cannot delete them.',
  'Defense Impairment': 'Alert the moment antivirus or logging is switched off.',
  'Credential Access': 'Use passkeys and alert when password files are copied.',
  Discovery: 'Flag unusual scanning or lookups inside the network.',
  'Lateral Movement': 'Split the network and give admins separate accounts.',
  Collection: 'Lock down who can reach sensitive files.',
  'Command and Control': 'Block and alert on traffic to unknown servers.',
  Exfiltration: 'Watch for large uploads and limit where data can go.',
  Impact: 'Keep offline backups and practise restoring them.',
};
const ROOM: Record<string, string> = {
  Reconnaissance: 'outside', 'Resource Development': 'outside',
  'Initial Access': 'door', Execution: 'offices', Persistence: 'offices', Discovery: 'offices', Collection: 'offices', 'Command and Control': 'offices',
  'Privilege Escalation': 'admin', Stealth: 'admin', 'Defense Impairment': 'admin',
  'Credential Access': 'vault', 'Lateral Movement': 'servers', Exfiltration: 'bay', Impact: 'servers',
};
const ICON: Record<string, IconName> = {
  Reconnaissance: 'binoculars', 'Resource Development': 'hammer-wrench', 'Initial Access': 'door-open', Execution: 'console',
  Persistence: 'anchor', 'Privilege Escalation': 'account-arrow-up-outline', Stealth: 'incognito', 'Defense Impairment': 'shield-off-outline',
  'Credential Access': 'key-chain-variant', Discovery: 'radar', 'Lateral Movement': 'transit-connection-variant', Collection: 'folder-zip-outline',
  'Command and Control': 'access-point-network', Exfiltration: 'cloud-upload-outline', Impact: 'lock-alert-outline',
};
const HOT = new Set(['Initial Access', 'Impact', 'Exfiltration']);
const short = (st: ChainStep) => SHORT[st.stage] ?? st.stage;
const icon = (st: ChainStep): IconName => ICON[st.stage] ?? 'shield-outline';
const open = (url?: string | null) => url && Linking.openURL(url).catch(() => {});

function useEntrance(trigger: unknown, duration = 380) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [trigger, v, duration]);
  return v;
}

function Links({ step, story, colour }: { step: ChainStep; story: Story; colour: string }) {
  const mitre = chainLink(step);
  const fromArticle = !step.source || step.source === 'article';
  return (
    <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
      {!!mitre && (
        <Pressable onPress={() => open(mitre)} hitSlop={8}>
          <Text style={{ color: colour, fontFamily: F.medium, fontSize: 12 }}>{step.technique || 'MITRE'} ↗</Text>
        </Pressable>
      )}
      <Pressable onPress={() => open(fromArticle ? story.url : step.source_url)} hitSlop={8}>
        <Text style={{ color: colour, fontFamily: F.medium, fontSize: 12 }}>{fromArticle ? 'From the article' : step.source}</Text>
      </Pressable>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Metro map: the attack as a train line. Stations snake down the page, two to a row; the train moves
// from stop to stop and a card explains each one. Every label sits on the side the line doesn't use.
// ------------------------------------------------------------------------------------------------
export function MetroChain({ story, steps, width, height }: Props) {
  const [i, setI] = useState(0);
  const n = steps.length;
  const sheetH = 200;
  const mapTop = 8;
  const mapH = Math.max(160, height - sheetH - 24);
  const rows = Math.ceil(n / 2);
  const rowH = Math.max(70, Math.min(130, (mapH - 40) / Math.max(1, rows - 1 || 1)));
  const L = 44, R = width - 44;
  const pts = steps.map((_, k) => {
    const r = Math.floor(k / 2), first = k % 2 === 0;
    const leftToRight = r % 2 === 0;
    return { x: first === leftToRight ? L : R, y: mapTop + 20 + r * rowH, first, r };
  });
  // the route: across each row, then down the side to the next row
  const route = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const done = pts.slice(0, i + 1).map((p) => `${p.x},${p.y}`).join(' ');
  const train = useRef(new Animated.ValueXY({ x: pts[0].x, y: pts[0].y })).current;
  useEffect(() => {
    Animated.spring(train, { toValue: { x: pts[i].x, y: pts[i].y }, friction: 7, useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, pts[i].x, pts[i].y, train]);
  const ping = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.timing(ping, { toValue: 1, duration: 1400, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [ping]);
  const card = useEntrance(i);
  const st = steps[i];
  const labelW = width / 2 - 24;

  return (
    <View style={{ flex: 1, backgroundColor: '#F7F5F0' }}>
      <View style={{ height: mapH + 20 }}>
        <Svg width={width} height={mapH + 20} style={StyleSheet.absoluteFill}>
          <Polyline points={route} fill="none" stroke="#E2DED4" strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" />
          <Polyline points={done} fill="none" stroke="#E5372A" strokeWidth={9} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p, k) => (
            <Circle key={k} cx={p.x} cy={p.y} r={HOT.has(steps[k].stage) ? 12 : 9} fill="#FFFFFF" stroke={k <= i ? '#141A2E' : '#C9C4B8'} strokeWidth={HOT.has(steps[k].stage) ? 5 : 4} />
          ))}
        </Svg>
        {pts.map((p, k) => {
          // first station of a row: the line arrives from above, so its name goes below; the other goes above
          const below = p.first;
          const onLeft = p.x === L;
          return (
            <Pressable
              key={k}
              onPress={() => setI(k)}
              hitSlop={6}
              style={{ position: 'absolute', top: below ? p.y + 14 : p.y - 32, left: onLeft ? 14 : undefined, right: onLeft ? undefined : 14, width: labelW, paddingVertical: 2 }}
              accessibilityRole="button"
            >
              <Text numberOfLines={1} style={{ textAlign: onLeft ? 'left' : 'right', fontFamily: k === i ? F.head : F.label, fontSize: 13, color: k <= i ? '#141A2E' : '#9A968C' }}>{short(steps[k])}</Text>
            </Pressable>
          );
        })}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -11, top: -11, transform: train.getTranslateTransform() }}>
          <Animated.View style={[styles.train, { position: 'absolute', opacity: ping.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: ping.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] }]} />
          <View style={[styles.train, { borderWidth: 3, borderColor: '#FFFFFF' }]} />
        </Animated.View>
      </View>
      <Animated.View style={[styles.metroCard, { opacity: card, transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ backgroundColor: '#E5372A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 11, letterSpacing: 1 }}>STOP {i + 1} OF {n}</Text>
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.label, fontSize: 12 }}>{st.stage}</Text>
        </View>
        <Text style={{ color: '#FFFFFF', fontFamily: F.medium, fontSize: 15, lineHeight: 21, marginTop: 8 }} numberOfLines={3}>{st.detail}</Text>
        <Links step={st} story={story} colour="rgba(255,255,255,0.55)" />
        <Pressable onPress={() => setI(i === n - 1 ? 0 : i + 1)} style={styles.whiteBtn} accessibilityRole="button">
          <Text style={{ color: '#141A2E', fontFamily: F.head, fontSize: 14.5 }}>{i === n - 1 ? 'End of the line · Ride again' : 'Next stop'}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Story mode: one step per screen, like phone stories. Tap right for the next step, left to go back.
// ------------------------------------------------------------------------------------------------
const STORY_BG: Record<string, [string, string]> = {
  hot: ['#F04438', '#5C130D'],
  calm: ['#334155', '#0F172A'],
  creds: ['#7C3AED', '#2E1065'],
  move: ['#2563EB', '#172554'],
  end: ['#059669', '#022C22'],
};
const bgFor = (st: ChainStep) =>
  HOT.has(st.stage) ? STORY_BG.hot : st.stage === 'Credential Access' || st.stage === 'Privilege Escalation' ? STORY_BG.creds : st.stage === 'Lateral Movement' || st.stage === 'Discovery' ? STORY_BG.move : STORY_BG.calm;

export function StoryChain({ story, steps }: Props) {
  const [i, setI] = useState(0);
  const n = steps.length;
  const end = i === n;
  const a = useEntrance(i, 420);
  const st = steps[Math.min(i, n - 1)];
  const first = steps.find((x) => x.stage === 'Initial Access') ?? steps[0];
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={end ? STORY_BG.end : bgFor(st)} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text style={styles.bigNumber} numberOfLines={1}>{end ? '✓' : String(i + 1).padStart(2, '0')}</Text>
      <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingTop: 6 }}>
        {[...steps, null].map((_, k) => (
          <View key={k} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: k <= i ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }} />
        ))}
      </View>
      <Animated.View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 26, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
        <View style={styles.storyIcon}>
          <MaterialCommunityIcons name={end ? 'shield-check-outline' : icon(st)} size={52} color="#FFFFFF" />
        </View>
        <Text style={{ color: 'rgba(255,255,255,0.75)', fontFamily: F.head, fontSize: 12.5, letterSpacing: 2, marginTop: 24 }}>
          {end ? 'THE WHOLE ATTACK' : `STEP ${i + 1} · ${st.stage.toUpperCase()}`}
        </Text>
        <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 32, lineHeight: 37, letterSpacing: -1, marginTop: 6 }}>{end ? `${n} steps, start to finish` : short(st)}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.92)', fontFamily: F.medium, fontSize: 17, lineHeight: 25, marginTop: 12 }}>
          {end ? `It could have been stopped at the start. ${DEFEND[first.stage] ?? ''}` : st.detail}
        </Text>
        {end ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 18 }}>
            {steps.map((x, k) => (
              <View key={k} style={[styles.miniIcon, HOT.has(x.stage) && { backgroundColor: '#FFFFFF' }]}>
                <MaterialCommunityIcons name={icon(x)} size={18} color={HOT.has(x.stage) ? '#B42318' : '#FFFFFF'} />
              </View>
            ))}
          </View>
        ) : (
          <Links step={st} story={story} colour="rgba(255,255,255,0.75)" />
        )}
      </Animated.View>
      {/* tap zones: left third goes back, the rest goes forward */}
      <Pressable onPress={() => setI(Math.max(0, i - 1))} style={[styles.zone, { left: 0, width: '33%' }]} accessibilityLabel="Previous step" />
      <Pressable onPress={() => setI(end ? 0 : i + 1)} style={[styles.zone, { right: 0, width: '67%' }]} accessibilityLabel="Next step" />
      <Text style={styles.storyHint}>{end ? 'Tap to watch again' : 'Tap for the next step'}</Text>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Break-in map: the company as a building. A hooded figure walks room to room, leaving a red trail.
// ------------------------------------------------------------------------------------------------
const ROOMS = [
  { id: 'admin', name: 'Admin office', x: 90, y: 90 },
  { id: 'servers', name: 'Server room', x: 230, y: 90 },
  { id: 'offices', name: 'Offices', x: 90, y: 206 },
  { id: 'vault', name: 'Password vault', x: 230, y: 206 },
  { id: 'door', name: 'Front door', x: 90, y: 322 },
  { id: 'bay', name: 'Loading bay', x: 230, y: 322 },
];
const spot = (room: string, k: number) => {
  if (room === 'outside') return { x: 44, y: 430 };
  const r = ROOMS.find((x) => x.id === room) ?? ROOMS[2];
  return { x: r.x + 40 + (k % 3) * 30, y: r.y + 98 };
};

export function BreakInChain({ story, steps, width, height }: Props) {
  const [i, setI] = useState(0);
  const n = steps.length;
  const sheetH = 196;
  const k = Math.min(width / 390, (height - sheetH - 10) / 450);
  const where = steps.map((st, j) => spot(ROOM[st.stage] ?? 'offices', j));
  const hit = new Set(steps.slice(0, i + 1).map((st) => ROOM[st.stage] ?? 'offices'));
  const impact = steps[i].stage === 'Impact';
  const walker = useRef(new Animated.ValueXY(where[0])).current;
  useEffect(() => {
    Animated.timing(walker, { toValue: where[i], duration: 650, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, where[i].x, where[i].y, walker]);
  const alarm = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!impact) return alarm.setValue(0);
    const a = Animated.loop(Animated.sequence([
      Animated.timing(alarm, { toValue: 0.55, duration: 500, useNativeDriver: true }),
      Animated.timing(alarm, { toValue: 0.15, duration: 500, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [impact, alarm]);
  const card = useEntrance(i);
  const st = steps[i];
  return (
    <View style={{ flex: 1, backgroundColor: '#0B1026' }}>
      <View style={{ width: 390 * k, height: 450 * k, alignSelf: 'center' }}>
        <View style={{ width: 390, height: 450, transformOrigin: 'top left', transform: [{ scale: k }] }}>
          <Svg width={390} height={450}>
            <Circle cx={340} cy={36} r={13} fill="#FDE68A" opacity={0.8} />
            <Path d="M80 90 L230 34 L380 90 Z" fill="#232B52" stroke="#3A4478" strokeWidth={2} />
            {ROOMS.map((r) => (
              <Rect key={r.id} x={r.x} y={r.y} width={140} height={116} fill={hit.has(r.id) ? 'rgba(255,90,78,0.38)' : '#1F2752'} stroke="#3A4478" strokeWidth={2} />
            ))}
            <Path d="M0 438 H390" stroke="#3A4478" strokeWidth={3} />
            <Polyline points={where.slice(0, i + 1).map((p) => `${p.x},${p.y - 6}`).join(' ')} fill="none" stroke="#FF5A4E" strokeWidth={3} strokeDasharray="2 7" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          {ROOMS.map((r) => (
            <Text key={r.id} style={{ position: 'absolute', left: r.x, top: r.y + 12, width: 140, textAlign: 'center', fontFamily: F.label, fontSize: 12.5, color: hit.has(r.id) ? '#FFFFFF' : '#8C96C8' }}>{r.name}</Text>
          ))}
          <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 90, top: 90, width: 280, height: 348, backgroundColor: '#FF2D20', opacity: alarm }} />
          <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -18, top: -40, transform: walker.getTranslateTransform() }}>
            <Svg width={36} height={44} viewBox="0 0 36 44">
              <Path d="M4 44 Q4 24 18 24 Q32 24 32 44 Z" fill="#0B0F1F" stroke="#FF5A4E" strokeWidth={2} />
              <Path d="M6 20 Q6 2 18 2 Q30 2 30 20 Q30 28 18 28 Q6 28 6 20 Z" fill="#0B0F1F" stroke="#FF5A4E" strokeWidth={2} />
              <Rect x={11} y={13} width={14} height={5} rx={2.5} fill="#FF5A4E" />
            </Svg>
          </Animated.View>
        </View>
      </View>
      <Animated.View style={[styles.breakCard, { opacity: card, transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
        <Text style={{ color: '#D92D20', fontFamily: F.head, fontSize: 11.5, letterSpacing: 1 }}>STEP {i + 1} OF {n} · {st.stage.toUpperCase()}</Text>
        <Text style={{ color: '#141A2E', fontFamily: F.medium, fontSize: 15, lineHeight: 21, marginTop: 6 }} numberOfLines={3}>{st.detail}</Text>
        <Links step={st} story={story} colour="#8A8FA3" />
        <Pressable onPress={() => setI(i === n - 1 ? 0 : i + 1)} style={[styles.whiteBtn, { backgroundColor: '#141A2E' }]} accessibilityRole="button">
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 14.5 }}>{i === n - 1 ? 'Start again' : 'Next move'}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Defend: you are the defender. Tap a step to block it there; every later step never happens.
// ------------------------------------------------------------------------------------------------
export function DefendChain({ steps }: Props) {
  const [b, setB] = useState(-1);
  const n = steps.length;
  const after = n - 1 - b;
  return (
    <View style={{ flex: 1, backgroundColor: '#F4F6FA' }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 110, gap: 8 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        <Text style={{ color: '#0F7A47', fontFamily: F.head, fontSize: 12, letterSpacing: 1.5 }}>YOU ARE THE DEFENDER</Text>
        <Text style={{ color: '#141A2E', fontFamily: F.brand, fontSize: 23, lineHeight: 28, letterSpacing: -0.6, marginBottom: 6 }}>Tap a step to stop the attack there</Text>
        {steps.map((st, k) => {
          const blocked = k === b, gone = b >= 0 && k > b;
          return (
            <Pressable key={k} onPress={() => setB(blocked ? -1 : k)} style={[styles.defRow, blocked && styles.defBlocked, gone && { opacity: 0.45 }]} accessibilityRole="button">
              <View style={[styles.defDot, { backgroundColor: blocked ? '#0F7A47' : gone ? '#B8BECC' : '#D92D20' }]}>
                <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 14 }}>{blocked ? '✓' : k + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.head, fontSize: 11.5, letterSpacing: 1, color: blocked ? '#0F7A47' : gone ? '#8A8FA3' : '#D92D20' }}>
                  {blocked ? 'STOPPED HERE' : gone ? 'NEVER HAPPENS' : `STEP ${k + 1} · ${st.stage.toUpperCase()}`}
                </Text>
                <Text style={{ fontFamily: F.label, fontSize: 14.5, lineHeight: 20, color: '#141A2E', marginTop: 2, textDecorationLine: gone ? 'line-through' : 'none' }}>{st.detail}</Text>
                {blocked && (
                  <View style={styles.fix}>
                    <MaterialCommunityIcons name="shield-check" size={16} color="#FFFFFF" />
                    <Text style={{ flex: 1, color: '#FFFFFF', fontFamily: F.label, fontSize: 13.5, lineHeight: 19 }}>{DEFEND[st.stage] ?? 'Spot it early and shut it down.'}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={[styles.verdict, { backgroundColor: b < 0 ? '#141A2E' : '#0F7A47' }]} pointerEvents="none">
        <MaterialCommunityIcons name={b < 0 ? 'alert-outline' : 'shield-check'} size={26} color="#FFFFFF" />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 15.5 }}>{b < 0 ? 'Right now the attack wins' : b === 0 ? 'Stopped before it started' : `Attack stopped at step ${b + 1}`}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: F.body, fontSize: 12.5, lineHeight: 17, marginTop: 1 }}>
            {b < 0 ? 'Pick any one step. Breaking one link stops the whole chain.' : after > 0 ? `${after} later ${after === 1 ? 'step never happens' : 'steps never happen'}. Try another.` : 'Damage done, but you recover fast.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------------------------------------
// Viking raid: the attack told as a saga. A longship sails a winding sea route from shield to shield,
// each landing is a chapter, and the last one is the stronghold.
// ------------------------------------------------------------------------------------------------
const SHIELDS: [string, string][] = [['#1E4F8A', '#E8C547'], ['#8B1E14', '#F3E7C9'], ['#2F5D3A', '#E8C547'], ['#6B3FA0', '#F3E7C9']];

export function VikingChain({ story, steps, width, height }: Props) {
  const [i, setI] = useState(0);
  const n = steps.length;
  const sheetH = 236;
  const mapH = Math.max(180, height - sheetH - 8);
  // fits any number of landings: neighbours sit on opposite sides, so they can be closer than a shield's height
  const rowH = Math.max(32, Math.min(110, (mapH - 64) / Math.max(1, n - 1)));
  const pts = steps.map((_, k) => ({ x: k === n - 1 && n % 2 === 1 ? width / 2 : k % 2 ? width * 0.74 : width * 0.26, y: 30 + k * rowH }));
  const route = pts.map((p, k) => (k === 0 ? `M${p.x} ${p.y}` : `C${(pts[k - 1].x + p.x) / 2} ${pts[k - 1].y} ${(pts[k - 1].x + p.x) / 2} ${p.y} ${p.x} ${p.y}`)).join(' ');
  const ship = useRef(new Animated.ValueXY(pts[0])).current;
  useEffect(() => {
    Animated.timing(ship, { toValue: pts[i], duration: 800, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, pts[i].x, pts[i].y, ship]);
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [bob]);
  const facing = i > 0 && pts[i].x < pts[i - 1].x ? -1 : 1;
  const card = useEntrance(i);
  const st = steps[i];
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={['#123247', '#0A1C2B', '#07121C']} style={StyleSheet.absoluteFill} />
      <View style={{ height: mapH }}>
        <Svg width={width} height={mapH} style={StyleSheet.absoluteFill}>
          <Path d={`M16 ${mapH * 0.2} q10 -6 20 0 t20 0 M${width - 70} ${mapH * 0.08} q10 -6 20 0 t20 0 M${width * 0.42} ${mapH * 0.55} q10 -6 20 0 t20 0 M24 ${mapH * 0.8} q10 -6 20 0 t20 0`} fill="none" stroke="rgba(243,231,201,0.18)" strokeWidth={2} />
          <Path d={route} fill="none" stroke="rgba(243,231,201,0.35)" strokeWidth={3} strokeDasharray="2 8" strokeLinecap="round" />
          {pts.map((p, k) => {
            const [c1, c2] = SHIELDS[k % SHIELDS.length];
            return (
              <G key={k} opacity={k <= i ? 1 : 0.4}>
                <Circle cx={p.x} cy={p.y} r={18} fill={c1} stroke="#3B2A1A" strokeWidth={3} />
                <Path d={`M${p.x} ${p.y - 18} V${p.y + 18} M${p.x - 18} ${p.y} H${p.x + 18}`} stroke={c2} strokeWidth={6} />
                <Circle cx={p.x} cy={p.y} r={18} fill="none" stroke="#C9A45C" strokeWidth={3} />
                <Circle cx={p.x} cy={p.y} r={4.5} fill="#C9A45C" stroke="#3B2A1A" strokeWidth={2} />
              </G>
            );
          })}
        </Svg>
        {pts.map((p, k) => (
          <Pressable key={k} onPress={() => setI(k)} hitSlop={6} style={{ position: 'absolute', left: Math.max(4, Math.min(width - 164, p.x - 80)), top: p.y + 22, width: 160, alignItems: 'center' }} accessibilityRole="button">
            <Text numberOfLines={1} style={[styles.vikingLabel, { color: k <= i ? '#F3E7C9' : 'rgba(243,231,201,0.5)', fontFamily: k === i ? F.head : F.label }]}>{short(steps[k])}</Text>
          </Pressable>
        ))}
        {/* two layers: sailing (JS animation) and rocking (native animation) must never share one view, or phones crash */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -30, top: -54, transform: ship.getTranslateTransform() }}>
          <Animated.View style={{ transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }, { rotate: bob.interpolate({ inputRange: [0, 1], outputRange: ['-2deg', '2deg'] }) }, { scaleX: facing }] }}>
            <Svg width={60} height={52} viewBox="0 0 64 56">
              <Path d="M30 6 V40" stroke="#3B2A1A" strokeWidth={3} />
              <Path d="M14 8 H46 V34 H14 Z" fill="#F3E7C9" stroke="#3B2A1A" strokeWidth={2} />
              <Path d="M19 8 V34 M27 8 V34 M35 8 V34 M43 8 V34" stroke="#B42318" strokeWidth={4} />
              <Path d="M2 38 Q30 54 58 38 L62 30 Q60 26 56 30 L54 36 Q30 46 8 36 L6 30 Q2 28 2 34 Z" fill="#6B4423" stroke="#3B2A1A" strokeWidth={2} />
              <Circle cx={18} cy={42} r={3} fill="#C9A45C" />
              <Circle cx={30} cy={44} r={3} fill="#C9A45C" />
              <Circle cx={42} cy={42} r={3} fill="#C9A45C" />
            </Svg>
          </Animated.View>
        </Animated.View>
      </View>
      <Animated.View style={[styles.sagaCard, { opacity: card, transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: F.head, fontSize: 12.5, letterSpacing: 0.5, color: '#8B1E14' }}>Step {i + 1} of {n}</Text>
          <Text style={{ fontFamily: F.label, fontSize: 11, letterSpacing: 1, color: '#6B5A40' }} numberOfLines={1}>{st.stage.toUpperCase()}</Text>
        </View>
        <Text style={{ fontFamily: FS.serifBold, fontSize: 19, lineHeight: 25, color: '#2B1D12', marginTop: 6 }}>{short(st)}</Text>
        <Text style={{ fontFamily: FS.serif, fontSize: 13.5, lineHeight: 20, color: '#2B1D12', marginTop: 4 }} numberOfLines={3}>{st.detail}</Text>
        <Links step={st} story={story} colour="#6B5A40" />
        <Pressable onPress={() => setI(i === n - 1 ? 0 : i + 1)} style={[styles.whiteBtn, { backgroundColor: '#2B1D12' }]} accessibilityRole="button">
          <Text style={{ color: '#E8D9B5', fontFamily: F.head, fontSize: 15 }}>{i === n - 1 ? 'Start again' : 'Next step'}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  vikingLabel: { fontSize: 12, backgroundColor: 'rgba(7,18,28,0.8)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  sagaCard: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: '#E8D9B5', borderRadius: 10, borderWidth: 3, borderColor: '#C9A45C', padding: 16 },
  train: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#E5372A' },
  metroCard: { position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: '#141A2E', borderRadius: 22, padding: 16 },
  whiteBtn: { marginTop: 12, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  bigNumber: { position: 'absolute', right: -16, top: 70, fontFamily: F.brand, fontSize: 240, lineHeight: 250, color: 'rgba(255,255,255,0.08)', letterSpacing: -12 },
  storyIcon: { width: 104, height: 104, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  miniIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  zone: { position: 'absolute', top: 20, bottom: 40 },
  storyHint: { position: 'absolute', left: 0, right: 0, bottom: 14, textAlign: 'center', color: 'rgba(255,255,255,0.65)', fontFamily: F.label, fontSize: 12.5 },
  breakCard: { position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16 },
  defRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: 18, borderWidth: 2, borderColor: '#E3E6EE', backgroundColor: '#FFFFFF' },
  defBlocked: { borderColor: '#0F7A47', backgroundColor: '#E9F8EF' },
  defDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  fix: { flexDirection: 'row', gap: 8, marginTop: 8, padding: 10, borderRadius: 12, backgroundColor: '#0F7A47' },
  verdict: { position: 'absolute', left: 12, right: 12, bottom: 12, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
