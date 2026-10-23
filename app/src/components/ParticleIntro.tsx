import { Image } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

import { buzz, openingSound } from '../lib/buzz';
import { F } from '../theme';

const BG = '#05070F'; // same as the phone's own splash screen, so the hand-over is seamless
const LOGO = 200;
const DURATION = 2300; // the effect itself
const HOLD = 1000; // the finished logo stays on screen this long before the news shows
const LOCK = 0.68; // when the dots lock into the logo

// points inside the logo (x, y in a 200 x 200 box) and the logo's own colour at each point
const POINTS: [number, number, string][] = [
  [74.4, 37.5, "#02bcfd"],
  [76.0, 96.7, "#29cefd"],
  [78.1, 93.4, "#2ad0fd"],
  [91.8, 115.4, "#1e9ffe"],
  [43.2, 160.2, "#4b6ffe"],
  [43.0, 116.2, "#0276fc"],
  [85.4, 83.8, "#2cd4fd"],
  [79.3, 107.8, "#20bafe"],
  [134.6, 34.8, "#0a8ef3"],
  [124.4, 133.0, "#515afc"],
  [47.1, 53.7, "#03c5fe"],
  [98.4, 40.2, "#01a9fe"],
  [107.8, 121.5, "#207afc"],
  [74.8, 157.6, "#5d4bfa"],
  [118.4, 154.3, "#6440f8"],
  [35.9, 83.4, "#0143dd"],
  [147.5, 148.6, "#8844fc"],
  [91.2, 99.6, "#1bbbfd"],
  [78.5, 155.3, "#5949fb"],
  [15.4, 102.0, "#06c6fe"],
  [95.3, 156.6, "#4435f8"],
  [102.7, 168.2, "#3d27e8"],
  [111.9, 84.8, "#0dbdfd"],
  [27.5, 107.6, "#0063fa"],
  [143.0, 124.6, "#5258fc"],
  [26.8, 124.4, "#0173fb"],
  [127.5, 54.5, "#0280fd"],
  [136.5, 140.6, "#704cfc"],
  [102.7, 166.4, "#351ede"],
  [132.0, 155.3, "#7c44fb"],
  [120.3, 57.2, "#0181fd"],
  [130.7, 161.7, "#7840fc"],
  [100.2, 79.3, "#1ccefe"],
  [172.3, 80.1, "#05b6fe"],
  [85.5, 153.7, "#4b3ef7"],
  [83.8, 54.3, "#06aaf6"],
  [25.6, 110.5, "#0166fa"],
  [67.6, 45.1, "#03bcfd"],
  [110.0, 85.5, "#0ebefd"],
  [54.3, 161.9, "#5458fc"],
  [79.1, 79.7, "#33dafe"],
  [71.5, 90.4, "#30d7fd"],
  [63.7, 157.2, "#5959fa"],
  [89.5, 34.8, "#02b5fd"],
  [130.5, 81.8, "#05b2fd"],
  [39.5, 49.2, "#02c9f1"],
  [85.2, 96.9, "#21c6fd"],
  [123.8, 128.1, "#415efd"],
  [134.0, 56.1, "#027afd"],
  [34.4, 88.5, "#0049e4"],
  [65.6, 102.5, "#1dc4f0"],
  [124.6, 152.3, "#6e41f9"],
  [161.5, 107.6, "#2290fd"],
  [43.4, 76.6, "#0041da"],
  [103.9, 51.8, "#0197fe"],
  [113.5, 128.7, "#376efb"],
  [100.2, 78.9, "#1dcffe"],
  [87.3, 86.3, "#28d0fd"],
  [126.2, 126.0, "#4062fd"],
  [77.7, 87.1, "#2fd6fd"],
  [77.7, 38.7, "#02b9fd"],
  [80.1, 160.9, "#5b44f9"],
  [80.3, 143.0, "#373ff7"],
  [144.3, 46.1, "#027efe"],
  [73.6, 45.9, "#02b6fe"],
  [130.7, 156.2, "#7c44fa"],
  [84.0, 149.2, "#423ef7"],
  [143.8, 148.0, "#8245fb"],
  [162.1, 77.9, "#01b6fd"],
  [66.0, 37.9, "#02c4fd"],
  [103.1, 111.7, "#1999fe"],
  [46.5, 63.9, "#02c2fd"],
  [131.8, 147.9, "#7646fb"],
  [162.1, 82.6, "#00b5fa"],
  [136.5, 120.5, "#3f63fc"],
  [19.7, 92.8, "#01c2fd"],
  [109.2, 119.5, "#207efd"],
  [135.0, 86.3, "#02a6fd"],
  [47.7, 158.0, "#475efc"],
  [43.2, 94.7, "#0161f8"],
  [78.1, 150.2, "#534bfb"],
  [103.3, 100.2, "#0da6f6"],
  [63.9, 154.3, "#565bfb"],
  [113.3, 118.4, "#207efd"],
  [62.5, 163.5, "#6153fb"],
  [126.0, 159.0, "#7141f9"],
  [19.9, 127.5, "#0075fe"],
  [29.3, 89.5, "#0047e2"],
  [98.0, 45.9, "#02a2fd"],
  [49.6, 145.3, "#3667fc"],
  [104.7, 167.8, "#4027e9"],
  [116.0, 51.4, "#028cfc"],
  [45.5, 123.4, "#0a74fd"],
  [108.6, 76.0, "#12c8fa"],
  [75.8, 99.4, "#27cbfe"],
  [108.2, 103.7, "#13a4fe"],
  [88.9, 111.1, "#1caafc"],
  [64.3, 93.8, "#36d6fa"],
  [130.1, 116.2, "#2b70fc"],
  [73.4, 170.9, "#6f57ff"],
  [124.0, 85.2, "#06b3fc"],
  [32.6, 121.5, "#0274fd"],
  [113.1, 57.0, "#0087fd"],
  [87.5, 143.0, "#3b40fa"],
  [130.7, 146.5, "#7448fc"],
  [46.9, 128.9, "#1672fe"],
  [88.5, 159.8, "#523bf9"],
  [99.2, 33.6, "#01aefe"],
  [144.5, 146.1, "#8146fb"],
  [77.9, 147.3, "#3a3df5"],
  [25.6, 122.1, "#0070fc"],
  [33.6, 133.8, "#0e73fc"],
  [32.6, 109.4, "#006afa"],
  [42.0, 125.4, "#0b74fc"],
  [57.4, 38.9, "#04c8fe"],
  [135.0, 133.0, "#5d54fc"],
  [128.3, 81.6, "#05b5fd"],
  [116.8, 109.6, "#158efc"],
  [123.2, 45.9, "#028efd"],
  [121.3, 62.1, "#0179fc"],
  [125.0, 43.4, "#018efc"],
  [88.3, 159.8, "#523bf8"],
  [19.7, 86.9, "#02c6fd"],
  [53.7, 153.9, "#4a5ffb"],
  [128.7, 57.8, "#017cfd"],
  [103.7, 52.3, "#0296fe"],
  [59.6, 51.2, "#03bdfc"],
  [32.8, 140.6, "#1871fc"],
  [107.8, 38.7, "#02a2fd"],
  [33.0, 121.3, "#0274fd"],
  [166.6, 77.1, "#12b4f5"],
  [126.4, 124.2, "#3964fd"],
  [26.8, 143.8, "#1577f7"],
  [42.2, 157.6, "#3f61fc"],
  [94.9, 117.4, "#1e97fe"],
  [134.8, 156.8, "#8245fb"],
  [34.8, 102.5, "#0162f9"],
  [75.4, 79.9, "#33dafd"],
  [131.6, 123.8, "#4063fd"],
  [40.6, 56.2, "#05c9fe"],
  [37.7, 52.5, "#01cafd"],
  [77.1, 160.7, "#5e48fa"],
  [62.7, 49.6, "#03bdfd"],
  [28.9, 136.5, "#0b73fc"],
  [136.7, 122.7, "#4662fe"],
  [151.0, 81.8, "#01b0fa"],
  [133.0, 117.4, "#346cfd"],
  [41.0, 63.3, "#03c5fd"],
  [101.4, 119.3, "#1f87fe"],
  [79.1, 33.2, "#04bdfd"],
  [133.4, 131.6, "#5855fc"],
  [36.5, 144.3, "#2570fd"],
  [25.4, 105.7, "#015cf5"],
  [58.2, 49.0, "#03c1fd"],
  [145.3, 96.3, "#03a9fd"],
  [74.2, 30.5, "#04c4fe"],
  [134.4, 52.5, "#027efd"],
  [46.9, 45.7, "#03c8fd"],
  [150.6, 128.7, "#654ffd"],
  [97.7, 49.6, "#029ffd"],
  [178.7, 96.9, "#06aff8"],
  [158.2, 94.3, "#0cb1ff"],
  [39.3, 52.0, "#02cafd"],
  [97.5, 119.5, "#1d8cfc"],
  [18.2, 122.5, "#0070f9"],
  [125.4, 123.0, "#3567fc"],
  [82.4, 81.1, "#31d8fe"],
  [80.7, 94.3, "#28cdfd"],
  [42.4, 122.3, "#0776fd"],
  [125.0, 109.4, "#188df4"],
  [67.6, 89.3, "#33d9fe"],
  [122.9, 48.2, "#028afc"],
  [78.5, 107.4, "#20bbfe"],
  [72.3, 94.1, "#2dd3fd"],
  [118.2, 109.2, "#148dfc"],
  [148.8, 46.3, "#007cfd"],
  [72.1, 90.2, "#2fd6fd"],
  [110.5, 52.9, "#018efd"],
  [100.2, 169.3, "#412ceb"],
  [34.8, 65.6, "#03c7fe"]
];

/**
 * The opening: tiny dots in the logo's colours fly in from all over the screen and come together
 * into the CyberSid logo, which then goes solid with a ring of light, and stays a second before the news.
 * The phone patters faster and stronger as the dots rush in and thumps when they lock. Skipped with reduced motion.
 */
export function ParticleIntro({ onDone }: { onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(0)).current; // the fade to the news, after the hold
  const { width, height } = Dimensions.get('window');

  const dots = useMemo(() => {
    let seed = 5;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    return POINTS.map(([x, y, colour]) => ({
      x, y, colour,
      sx: (rnd() - 0.5) * width * 1.4,
      sy: (rnd() - 0.5) * height * 1.1,
      d: rnd() * 0.2,
      size: 3 + rnd() * 1.6,
    }));
  }, [width, height]);

  useEffect(() => {
    let stopped = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const sound = openingSound(); // loaded straight away so it starts exactly with the dots
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (stopped) return;
        if (reduce) {
          sound?.remove();
          onDone();
          return;
        }
        // vibration that follows the picture: a patter that speeds up and gets stronger as the dots
        // rush together, a double thump when they lock into the logo, then a soft pulse with the ring
        const lock = DURATION * LOCK;
        let at = 120;
        let gap = 150;
        while (at < lock - 60) {
          const near = at / lock; // 0 at the start, 1 at the lock
          timers.push(setTimeout(near < 0.45 ? buzz.tick : near < 0.8 ? buzz.tap : buzz.medium, at));
          at += gap;
          gap = Math.max(38, gap * 0.86);
        }
        timers.push(setTimeout(buzz.thump, lock));
        timers.push(setTimeout(buzz.thump, lock + 90));
        timers.push(setTimeout(buzz.soft, lock + 330));
        sound?.play(); // the Heartbeat: pulses race with the dots and hit on the lock
        Animated.sequence([
          Animated.timing(t, { toValue: 1, duration: DURATION, easing: Easing.linear, useNativeDriver: true }),
          Animated.delay(HOLD),
          Animated.timing(out, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start(() => onDone());
      })
      .catch(() => onDone());
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      // let the sound's tail finish over the news, then free it
      setTimeout(() => sound?.remove(), 2500);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const solid = t.interpolate({ inputRange: [LOCK - 0.02, LOCK + 0.08], outputRange: [0, 1], extrapolate: 'clamp' });
  const dotsGone = t.interpolate({ inputRange: [LOCK, LOCK + 0.1], outputRange: [1, 0], extrapolate: 'clamp' });
  const ring = t.interpolate({ inputRange: [LOCK, LOCK + 0.22], outputRange: [0.6, 2.2], extrapolate: 'clamp' });
  const ringOpacity = t.interpolate({ inputRange: [LOCK, LOCK + 0.04, LOCK + 0.22], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const word = t.interpolate({ inputRange: [LOCK + 0.06, LOCK + 0.18], outputRange: [0, 1], extrapolate: 'clamp' });
  const fade = out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]} pointerEvents="none">
      <View style={{ width: LOGO, height: LOGO }}>
        <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ring }] }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: dotsGone }]}>
          {dots.map((p, i) => {
            // a fast start that slows into place (ease-out, drawn from one shared clock)
            const range = [p.d, p.d + 0.12, p.d + 0.26, p.d + 0.46];
            const left = [1, 0.4, 0.12, 0];
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute', left: p.x - p.size / 2, top: p.y - p.size / 2, width: p.size, height: p.size, borderRadius: p.size,
                  backgroundColor: p.colour,
                  opacity: t.interpolate({ inputRange: [p.d, p.d + 0.08], outputRange: [0, 1], extrapolate: 'clamp' }),
                  transform: [
                    { translateX: t.interpolate({ inputRange: range, outputRange: left.map((k) => k * p.sx), extrapolate: 'clamp' }) },
                    { translateY: t.interpolate({ inputRange: range, outputRange: left.map((k) => k * p.sy), extrapolate: 'clamp' }) },
                    { scale: t.interpolate({ inputRange: [p.d, p.d + 0.46], outputRange: [0.3, 1], extrapolate: 'clamp' }) },
                  ],
                }}
              />
            );
          })}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: solid }]}>
          <Image source={require('../../assets/splash-icon.png')} style={{ width: LOGO, height: LOGO }} contentFit="contain" />
        </Animated.View>
      </View>
      <Animated.Text style={[styles.word, { opacity: word, transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>CYBERSID</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: BG, alignItems: 'center', justifyContent: 'center', zIndex: 100, elevation: 100 },
  ring: { position: 'absolute', left: 10, top: 10, width: LOGO - 20, height: LOGO - 20, borderRadius: LOGO, borderWidth: 1.5, borderColor: 'rgba(160,200,255,0.9)' },
  word: { position: 'absolute', top: '50%', marginTop: LOGO / 2 + 18, color: '#FFFFFF', fontFamily: F.body, fontSize: 20, letterSpacing: 4 },
});
