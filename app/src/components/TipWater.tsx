import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/**
 * Water in the tip box: two soft waves drift along the bottom of the box (on the card on screen), and when
 * the reader ticks the tip it fills up with green water. Sits behind the tip's icon, text and tick.
 */
const PERIOD = 100; // one wave crest every 100 px

function wave(width: number, height: number, mid: number, amp: number, phase: number) {
  let d = `M0 ${(mid + Math.sin(phase) * amp).toFixed(1)}`;
  for (let x = 5; x <= width; x += 5) d += ` L${x} ${(mid + Math.sin(phase + (x / PERIOD) * Math.PI * 2) * amp).toFixed(1)}`;
  return `${d} L${width} ${height} L0 ${height} Z`;
}

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = !!v; }).catch(() => {});

export function TipWater({ active, done, dim }: { active: boolean; done: boolean; dim: boolean }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const flow1 = useRef(new Animated.Value(0)).current;
  const flow2 = useRef(new Animated.Value(0)).current;
  const level = useRef(new Animated.Value(done ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(level, { toValue: done ? 1 : 0, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [done, level]);

  useEffect(() => {
    if (!active || reduceMotion) return;
    const loop = (v: Animated.Value, ms: number) =>
      Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
    const a = loop(flow1, 5500);
    const b = loop(flow2, 8500);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [active, flow1, flow2]);

  const { w, h } = box;
  // the water's surface: a little under half way up, or right at the top once the tip is done
  const rise = level.interpolate({ inputRange: [0, 1], outputRange: [h * 0.5, -6] });
  const width = w + PERIOD;
  const back = done ? 'rgba(34,197,94,0.20)' : dim ? 'rgba(255,200,40,0.16)' : 'rgba(255,200,40,0.28)';
  const front = done ? 'rgba(34,197,94,0.28)' : dim ? 'rgba(255,214,77,0.22)' : 'rgba(255,214,77,0.40)';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: rise }] }]}>
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: flow1.interpolate({ inputRange: [0, 1], outputRange: [0, -PERIOD] }) }] }}>
            <Svg width={width} height={h + 8}>
              <Path d={wave(width, h + 8, 6, 3.2, 0)} fill={back} />
            </Svg>
          </Animated.View>
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: flow2.interpolate({ inputRange: [0, 1], outputRange: [-PERIOD, 0] }) }] }}>
            <Svg width={width} height={h + 8}>
              <Path d={wave(width, h + 8, 9, 2.4, 1.7)} fill={front} />
            </Svg>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}
