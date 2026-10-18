import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

import { F } from '../theme';

const BG = '#05070F'; // same as the phone's own splash screen, so the hand-over is seamless
const LOGO = 200;
const DURATION = 1900;
const EMBERS = ['#7EC8FF', '#5B8CFF', '#A98BFF', '#C9D6EA', '#8A93A8', '#FFFFFF', '#3FA9FF'];

/**
 * The opening: the logo glows, then burns away from left to right into drifting embers and ash,
 * and the news shows through. Plays once per start, about two seconds. Skipped when the phone
 * asks for reduced motion.
 */
export function AshIntro({ onDone }: { onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;

  // where each ember starts and where it drifts to (fixed pattern, so it looks the same every time)
  const embers = useMemo(() => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return Array.from({ length: 70 }, () => {
      const x = rnd() * (LOGO - 20) + 10;
      const y = rnd() * (LOGO - 30) + 15;
      const start = 0.2 + 0.55 * (x / LOGO) + rnd() * 0.04;
      return {
        x, y, start,
        life: 0.3 + rnd() * 0.15,
        size: 2 + rnd() * 4.5,
        dx: 50 + rnd() * 150,
        dy: -(70 + rnd() * 240),
        colour: EMBERS[Math.floor(rnd() * EMBERS.length)],
      };
    });
  }, []);

  useEffect(() => {
    let stopped = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (stopped) return;
        if (reduce) {
          onDone();
          return;
        }
        Animated.timing(t, { toValue: 1, duration: DURATION, easing: Easing.linear, useNativeDriver: true }).start(() => onDone());
      })
      .catch(() => onDone());
    return () => {
      stopped = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scale = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.96, 1.02, 1.02], extrapolate: 'clamp' });
  // a dark cover slides over the logo from the left: the logo "burns" away behind its glowing edge
  const burn = t.interpolate({ inputRange: [0.2, 0.78], outputRange: [-LOGO - 12, 0], extrapolate: 'clamp' });
  const edgeOpacity = t.interpolate({ inputRange: [0.18, 0.22, 0.74, 0.8], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
  const word = t.interpolate({ inputRange: [0, 0.12, 0.62, 0.78], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' });
  const fade = t.interpolate({ inputRange: [0.84, 1], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]} pointerEvents="none">
      <View style={{ width: LOGO, height: LOGO }}>
        <Animated.View style={{ width: LOGO, height: LOGO, overflow: 'hidden', transform: [{ scale }] }}>
          <Image source={require('../../assets/splash-icon.png')} style={{ width: LOGO, height: LOGO }} contentFit="contain" />
          <Animated.View style={[styles.cover, { transform: [{ translateX: burn }] }]}>
            <Animated.View style={[styles.edge, { opacity: edgeOpacity }]}>
              <LinearGradient colors={['rgba(5,7,15,0)', '#9FD0FF', '#C9A8FF', 'rgba(5,7,15,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          </Animated.View>
        </Animated.View>
        {embers.map((e, i) => {
          const end = Math.min(1, e.start + e.life);
          const range = [e.start, e.start + 0.03, end];
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute', left: e.x, top: e.y, width: e.size, height: e.size, borderRadius: e.size,
                backgroundColor: e.colour, shadowColor: e.colour, shadowOpacity: 0.9, shadowRadius: 4,
                opacity: t.interpolate({ inputRange: [e.start - 0.001, ...range], outputRange: [0, 0, 1, 0], extrapolate: 'clamp' }),
                transform: [
                  { translateX: t.interpolate({ inputRange: [e.start, end], outputRange: [0, e.dx], extrapolate: 'clamp' }) },
                  { translateY: t.interpolate({ inputRange: [e.start, end], outputRange: [0, e.dy], extrapolate: 'clamp' }) },
                  { scale: t.interpolate({ inputRange: [e.start, end], outputRange: [1, 0.25], extrapolate: 'clamp' }) },
                ],
              }}
            />
          );
        })}
      </View>
      <Animated.Text style={[styles.word, { opacity: word }]}>CyberSid</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: BG, alignItems: 'center', justifyContent: 'center', zIndex: 100, elevation: 100 },
  cover: { position: 'absolute', top: 0, bottom: 0, left: 0, width: LOGO + 12, backgroundColor: BG },
  edge: { position: 'absolute', top: -10, bottom: -10, right: -6, width: 14 },
  word: { position: 'absolute', top: '50%', marginTop: LOGO / 2 + 18, color: '#FFFFFF', fontFamily: F.brand, fontSize: 26, letterSpacing: -0.5 },
});

