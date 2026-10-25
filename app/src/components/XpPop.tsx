import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

import { BADGES, progressReady, rankOf, useProgress } from '../lib/progress';
import { F } from '../theme';

/**
 * "+120 XP · 180 to Analyst" pops up at the top of a game when it's finished (and a new badge or rank is named).
 * Shown on every game, wherever it's played: between the news, inside an attack chain, or in the Play section.
 */
export function XpPop({ active }: { active: boolean }) {
  const p = useProgress();
  const badges = Object.keys(p.badges);
  const was = useRef({ xp: p.xp, badges, ready: progressReady() });
  const [shown, setShown] = useState<{ line: string; sub: string } | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!was.current.ready) {
      // the saved progress just loaded: that's the starting point, not XP won
      was.current = { xp: p.xp, badges, ready: progressReady() };
      return;
    }
    const got = p.xp - was.current.xp;
    const badge = badges.find((id) => !was.current.badges.includes(id)) ?? null;
    const before = rankOf(was.current.xp);
    was.current = { xp: p.xp, badges, ready: true };
    if (!active || (got <= 0 && !badge)) return;
    const rank = rankOf(p.xp);
    setShown({
      line: got > 0 ? `+${got} XP` : 'New badge',
      sub:
        rank.index > before.index
          ? `You're now ${rank.name}!`
          : badge && BADGES[badge]
            ? `Badge: ${BADGES[badge].name} ${BADGES[badge].icon}`
            : rank.next
              ? `${rank.toNext.toLocaleString()} XP to ${rank.next}`
              : 'Top rank',
    });
    fade.setValue(0);
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(fade, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [p.xp, badges.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pop, { opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }]}
    >
      <Text style={{ color: '#06210F', fontFamily: F.brand, fontSize: 14 }}>{shown.line}</Text>
      <Text style={{ color: '#0B3B1C', fontFamily: F.label, fontSize: 11.5 }} numberOfLines={1}>{shown.sub}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pop: {
    position: 'absolute', top: 48, right: 10, maxWidth: '78%', backgroundColor: '#4ADE80', borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6, alignItems: 'flex-end',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
});
