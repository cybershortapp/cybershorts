import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { GameStyle, PoolGame } from '../lib/extras';
import { BADGES, getProgress, levelOf, markDone, rankOf, streakOf, totalPlays, useProgress } from '../lib/progress';
import { READY } from '../lib/readyGames';
import { F } from '../theme';
import { ErrorBoundary } from './ErrorBoundary';
import { GameCard } from './Games';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

/**
 * The Play section (the gamepad button): the reader's rank, XP, streak and badges, plus three games that are
 * always ready. The news games themselves live between the news cards and inside each attack chain.
 */
const INFO: Record<GameStyle, { name: string; icon: IconName; tint: [string, string] }> = {
  scam_or_legit: { name: 'Scam or legit?', icon: 'gesture-swipe-horizontal', tint: ['#FDBA74', '#EA580C'] },
  patch_or_panic: { name: 'Patch or panic', icon: 'bomb', tint: ['#818CF8', '#3730A3'] },
  red_flags: { name: 'Spot the red flags', icon: 'flag-variant', tint: ['#7DD3FC', '#0369A1'] },
  real_link: { name: 'Which link is real?', icon: 'link-variant', tint: ['#FCD34D', '#B45309'] },
  order_steps: { name: 'What do you do first?', icon: 'format-list-numbered', tint: ['#C4B5FD', '#6D28D9'] },
  crack_meter: { name: 'Crack-o-meter', icon: 'form-textbox-password', tint: ['#4ADE80', '#166534'] },
  hot_seat: { name: 'Help desk hot seat', icon: 'phone-in-talk', tint: ['#7DD3FC', '#1E3A8A'] },
  approve: { name: "Don't tap Approve", icon: 'cellphone-message', tint: ['#F0ABFC', '#7C3AED'] },
  home: { name: 'Lock up your digital home', icon: 'home-lock', tint: ['#FDE68A', '#B45309'] },
  overshare: { name: 'Overshare detective', icon: 'account-search', tint: ['#FDA4AF', '#BE185D'] },
};

/** backRef: the Android back button asks the hub first (it closes an open game). */
export function PlayHub({ backRef }: { backRef: MutableRefObject<() => boolean> }) {
  const p = useProgress();
  const rank = rankOf(p.xp);
  const streak = streakOf(p);
  const [open, setOpen] = useState<PoolGame | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const { width } = useWindowDimensions();
  const playsAtOpen = useRef(0);
  const done = new Set(p.done ?? []);
  const panelW = Math.min(width - (width >= 600 ? 48 : 24), 760);
  // four badges to a row, each wide enough for its name on two lines
  const cell = Math.floor((panelW - 28 - 34) / 4); // minus the list and card padding and borders

  const start = (g: PoolGame) => {
    playsAtOpen.current = totalPlays(getProgress());
    setOpen(g);
  };
  const close = () => {
    // finished at least once while open: tick it
    if (open && totalPlays(getProgress()) > playsAtOpen.current) markDone(open.id);
    setOpen(null);
  };
  backRef.current = () => {
    if (!open) return false;
    close();
    return true;
  };
  useEffect(() => () => { backRef.current = () => false; }, [backRef]);

  const panel = { width: panelW, alignSelf: 'center' as const };

  if (open) {
    return (
      <View key="game" style={[styles.panel, panel, { flex: 1 }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <Pressable onPress={close} style={styles.backRow} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back to all games">
          <MaterialCommunityIcons name="chevron-left" size={22} color="#F5F6FA" />
          <Text style={{ color: '#F5F6FA', fontFamily: F.label, fontSize: 13.5 }}>All games</Text>
        </Pressable>
        {box.h > 0 && (
          <View style={{ alignItems: 'center' }}>
            <ErrorBoundary
              resetKey={open.id}
              fallback={() => <Text style={[styles.empty, { padding: 24, textAlign: 'center' }]}>Sorry, this game didn't load. Try another one.</Text>}
            >
              <GameCard key={open.id} game={open} headline={open.headline} image={open.image} width={Math.min(box.w - 16, 520)} height={box.h - 52} active foot="Finish to earn XP" onDone={close} doneLabel="Back to all games" />
            </ErrorBoundary>
          </View>
        )}
      </View>
    );
  }

  return (
    <View key="list" style={[styles.panel, panel, { flex: 1 }]}>
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      <View style={styles.profile}>
        <LinearGradient colors={['#1E1B4B', '#0F172A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <LinearGradient colors={['#7C3AED', '#2563F5']} style={styles.rankBadge}>
            <MaterialCommunityIcons name="shield-star" size={28} color="#FFFFFF" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#4ADE80', fontFamily: F.head, fontSize: 11, letterSpacing: 1.3 }}>{rank.name.toUpperCase()} · LEVEL {levelOf(p.xp)}</Text>
            <Text style={{ color: '#FFFFFF', fontFamily: F.brand, fontSize: 22, marginTop: 1 }}>{p.xp.toLocaleString()} XP</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 22, opacity: streak ? 1 : 0.35 }}>🔥</Text>
            <Text style={{ color: streak ? '#FB923C' : 'rgba(255,255,255,0.5)', fontFamily: F.head, fontSize: 11 }}>{streak} {streak === 1 ? 'day' : 'days'}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
          <Text style={styles.small}>{rank.next ? `${rank.toNext.toLocaleString()} XP to ${rank.next}` : 'Top rank reached'}</Text>
          <Text style={styles.small}>Rank {rank.index + 1} of 5</Text>
        </View>
        <View style={styles.bar}>
          <LinearGradient colors={['#4ADE80', '#22D3EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: '100%', width: `${Math.max(3, rank.progress * 100)}%` }} />
        </View>
        <Text style={[styles.kick, { marginTop: 14 }]}>BADGES · {Object.keys(p.badges).length} OF {Object.keys(BADGES).length}</Text>
        <View style={styles.badges}>
          {Object.entries(BADGES).map(([id, b]) => {
            const got = !!p.badges[id];
            return (
              <View key={id} style={{ width: cell, alignItems: 'center', marginBottom: 8 }}>
                <View style={[styles.badge, { backgroundColor: got ? '#FDE68A' : 'rgba(255,255,255,0.08)', opacity: got ? 1 : 0.5 }]}>
                  <Text style={{ fontSize: 19 }} maxFontSizeMultiplier={1.2}>{got ? b.icon : '🔒'}</Text>
                </View>
                <Text style={{ color: got ? '#FFFFFF' : 'rgba(255,255,255,0.45)', fontFamily: F.medium, fontSize: 10, lineHeight: 13, textAlign: 'center', marginTop: 4, paddingHorizontal: 2 }} numberOfLines={2} maxFontSizeMultiplier={1.15}>
                  {b.name}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.how}>
        <MaterialCommunityIcons name="gamepad-variant" size={20} color="#4ADE80" />
        <Text style={{ flex: 1, color: 'rgba(255,255,255,0.8)', fontFamily: F.body, fontSize: 13, lineHeight: 19 }}>
          Earn XP with the games between the news cards and inside each attack chain. Play every day to keep your streak.
        </Text>
      </View>
      <Text style={[styles.section, { marginTop: 18 }]}>Always ready</Text>
      {READY.map((g) => <Row key={g.id} g={g} about={g.headline} done={done.has(g.id)} onPress={() => start(g)} />)}
      <Text style={[styles.empty, { marginTop: 14 }]}>Your XP, streak and badges are kept on this phone only.</Text>
    </ScrollView>
    </View>
  );
}

function Row({ g, about, done, onPress }: { g: PoolGame; about: string; done: boolean; onPress: () => void }) {
  const i = INFO[g.style];
  if (!i) return null;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <LinearGradient colors={i.tint} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rowIcon}>
        <MaterialCommunityIcons name={i.icon} size={22} color="#FFFFFF" />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#FFFFFF', fontFamily: F.head, fontSize: 14.5 }}>{i.name}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontFamily: F.body, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{about}</Text>
      </View>
      {done ? <MaterialCommunityIcons name="check-circle" size={20} color="#4ADE80" /> : <MaterialCommunityIcons name="play-circle" size={24} color="#FFFFFF" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // always a dark "game zone", whatever the reader's theme
  panel: { backgroundColor: '#0B1020', borderRadius: 24, overflow: 'hidden', marginBottom: 8 },
  profile: { borderRadius: 22, padding: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  rankBadge: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  small: { color: 'rgba(255,255,255,0.55)', fontFamily: F.medium, fontSize: 10.5 },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', marginTop: 5, overflow: 'hidden' },
  kick: { color: 'rgba(255,255,255,0.55)', fontFamily: F.head, fontSize: 10.5, letterSpacing: 1.3 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  section: { color: '#FFFFFF', fontFamily: F.brand, fontSize: 18, marginBottom: 8 },
  empty: { color: 'rgba(255,255,255,0.6)', fontFamily: F.body, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', marginBottom: 8 },
  rowIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  how: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 12, borderRadius: 16, backgroundColor: 'rgba(74,222,128,0.08)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.25)' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 10 },
});
