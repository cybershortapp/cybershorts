import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, type TextStyle, View } from 'react-native';

/**
 * A headline with a "water wave": every 6 seconds a ripple of light runs through the letters and each letter
 * lifts a little as it passes, then the headline sits still so it stays easy to read. Only on the card on
 * screen, and never when the phone's Reduce Motion setting is on.
 * The letters are laid out word by word; a headline that would need more than `lines` lines this way falls
 * back to the normal text (shortened with "...") with no wave.
 */
type Props = {
  text: string;
  style: TextStyle; // fontSize, lineHeight, fontFamily, letterSpacing, color
  lines: number;
  active: boolean;
  colors: [string, string]; // the two colours of the wave of light
};

const SWEEP = 2400; // the ripple takes 2.4 seconds to cross the headline
const REST = 3600; // then 3.6 seconds still: one wave every 6 seconds

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = !!v; }).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => { reduceMotion = !!v; });

export function WaveText({ text, style, lines, active, colors }: Props) {
  const ink = (style.color as string) ?? '#14161F';
  const lineH = (style.lineHeight as number) ?? Math.round(((style.fontSize as number) ?? 20) * 1.2);
  const [tooLong, setTooLong] = useState(false);
  useEffect(() => setTooLong(false), [text]);
  const lift = useRef(new Animated.Value(0)).current; // moves letters (runs off the JS thread)
  const glow = useRef(new Animated.Value(0)).current; // colours letters

  const words = useMemo(() => {
    const parts = text.trim().split(/\s+/);
    const total = Math.max(1, parts.join('').length);
    let i = 0;
    return parts.map((w, wi) => ({
      key: `${wi}-${w}`,
      space: wi < parts.length - 1,
      letters: Array.from(w).map((c) => {
        // where in the sweep this letter's moment comes. Never exactly 0: the first letter's points would then be
        // [0, 0, ...], and the phone's own animation (iPhone) divides by that zero gap, so the first letter vanished
        // between waves (when the wave rests at 0)
        const at = 0.02 + (i++ / total) * 0.6;
        return { c, at };
      }),
    }));
  }, [text]);

  const on = active && !tooLong && !reduceMotion;
  useEffect(() => {
    if (!on) {
      lift.setValue(0);
      glow.setValue(0);
      return;
    }
    const run = (v: Animated.Value, native: boolean) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(700),
          Animated.timing(v, { toValue: 1, duration: SWEEP, easing: Easing.linear, useNativeDriver: native }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: native }),
          Animated.delay(REST - 700),
        ]),
      );
    const a = run(lift, true);
    const b = run(glow, false);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [on, lift, glow]);

  if (tooLong) {
    return (
      <Text style={style} numberOfLines={lines} accessibilityRole="header">
        {text}
      </Text>
    );
  }
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap' }}
      accessible
      accessibilityRole="header"
      accessibilityLabel={text}
      onLayout={(e) => {
        if (e.nativeEvent.layout.height > lineH * lines + 2) setTooLong(true);
      }}
    >
      {words.map((w) => (
        <View key={w.key} style={{ flexDirection: 'row' }} importantForAccessibility="no-hide-descendants">
          {w.letters.map((l, k) => {
            const range = [0, l.at, l.at + 0.05, l.at + 0.1, l.at + 0.16, 1];
            // the lift (run off the JS thread) and the colour (run on it) sit on different views: React Native
            // can't mix the two kinds of animation on one view, and doing so crashes the app
            return (
              <Animated.View
                key={k}
                style={on ? { transform: [{ translateY: lift.interpolate({ inputRange: range, outputRange: [0, 0, -3, 1.2, 0, 0] }) }] } : undefined}
              >
                <Animated.Text
                  style={[style, on && { color: glow.interpolate({ inputRange: range, outputRange: [ink, ink, colors[0], colors[1], ink, ink] }) }]}
                >
                  {l.c}
                </Animated.Text>
              </Animated.View>
            );
          })}
          {w.space && <Text style={style}> </Text>}
        </View>
      ))}
    </View>
  );
}
