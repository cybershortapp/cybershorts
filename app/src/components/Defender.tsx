import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { buzz } from '../lib/buzz';
import { BADGES, recordResult } from '../lib/progress';
import type { Explainer, Story } from '../lib/types';
import { F, FS } from '../theme';

/**
 * Play defender: the same attack hits the reader's own company, and they make the calls.
 * One "Your move" per decision point the server wrote for this story. The first right answer stops the
 * attack at that step (everything after it never happens); all wrong and the attack wins.
 * Then three quick questions about their real setup give a readiness score.
 */
type Props = { story: Story; explainer: Explainer; dark: boolean; s: number; onClose: () => void };

export function Defender({ story, explainer, dark, s, onClose }: Props) {
  const steps = story.attack_chain ?? [];
  const moves = explainer.defend;
  const [d, setD] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [stopped, setStopped] = useState<number | null>(null); // index into moves
  const [done, setDone] = useState(false);
  const [checks, setChecks] = useState<(boolean | null)[]>([null, null, null]);
  const [reward, setReward] = useState<{ xp: number; badge: string | null } | null>(null);
  const P = dark ? DK : LT;
  const move = moves[Math.min(d, moves.length - 1)];
  const answered = picked !== null;
  const right = answered && picked === move.answer;
  const lastMove = d >= moves.length - 1;
  const stoppedStep = stopped === null ? null : moves[stopped].step;
  const atStep = stoppedStep ?? (done ? steps.length - 1 : move.step);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [d, done, enter]);

  const pick = (k: number) => {
    if (answered) return;
    setPicked(k);
    if (k === move.answer) {
      setStopped(d);
      buzz.right();
    } else buzz.wrong();
  };
  const finish = () => {
    // stopping it at the first move is worth the most
    const stars = stopped === null ? 0 : Math.max(1, 3 - stopped);
    const r = recordResult({ game: 'defender', won: stopped !== null, xp: stopped === null ? 20 : stars * 100, badge: stars === 3 ? 'defender' : undefined });
    setReward({ xp: r.xp, badge: r.newBadge });
    setDone(true);
  };
  const next = () => {
    if (right || lastMove) finish();
    else {
      setD(d + 1);
      setPicked(null);
    }
  };
  const again = () => {
    setD(0);
    setPicked(null);
    setStopped(null);
    setDone(false);
    setReward(null);
  };

  const stars = stopped === null ? 0 : Math.max(1, 3 - stopped);
  const yes = checks.filter((c) => c === true).length;
  const enterStyle = { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: P.bg }]}>
      {dark && <LinearGradient colors={['rgba(74,222,128,0.12)', 'rgba(7,8,13,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 0.5 }} style={StyleSheet.absoluteFill} />}
      <View style={styles.top}>
        <Pressable onPress={onClose} hitSlop={10} style={[styles.close, { backgroundColor: P.chip, borderColor: P.border }]} accessibilityLabel="Back to the chain">
          <MaterialCommunityIcons name="close" size={18 * s} color={P.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: P.green, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.6 }}>PLAY DEFENDER</Text>
          <Text style={{ color: P.text, fontFamily: dark ? F.brand : FS.display, fontSize: 19 * s, lineHeight: 23 * s }}>Same attack. Your company.</Text>
        </View>
      </View>

      {/* the attack path: red where it has reached, a green shield where you stopped it, faded after that */}
      <View style={styles.rail}>
        <View style={[styles.track, { backgroundColor: P.border }]}>
          <View style={{ height: 2, backgroundColor: stoppedStep !== null ? P.green : P.red, width: `${(Math.max(0, stoppedStep ?? atStep) / Math.max(1, steps.length - 1)) * 100}%` }} />
        </View>
        {steps.map((st, i) => {
          const blocked = stoppedStep === i, ghost = stoppedStep !== null && i > stoppedStep, reached = !ghost && i <= atStep;
          return (
            <View key={i} style={[styles.node, { width: 30 * s, height: 30 * s, borderRadius: 15 * s, backgroundColor: blocked ? P.green : reached ? P.red : P.bg, borderColor: blocked ? P.green : reached ? P.red : P.border, opacity: ghost ? 0.35 : 1 }]}>
              {blocked ? <MaterialCommunityIcons name="shield-check" size={16 * s} color="#FFFFFF" /> : <Text style={{ color: reached ? '#FFFFFF' : P.muted, fontFamily: F.head, fontSize: 12 * s }}>{i + 1}</Text>}
            </View>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        {!done ? (
          <Animated.View style={enterStyle}>
            <Text style={{ color: P.green, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.4 }}>YOUR MOVE · STEP {move.step + 1} OF {steps.length}</Text>
            <View style={[styles.situation, { backgroundColor: P.redSoft, borderColor: P.redBorder }]}>
              <Text style={{ color: P.text, fontFamily: F.label, fontSize: 15 * s, lineHeight: 21 * s }}>{move.situation}</Text>
            </View>
            <View style={{ gap: 8, marginTop: 10 }}>
              {move.options.map((o, k) => {
                const good = answered && k === move.answer, bad = answered && k === picked && !good;
                return (
                  <Pressable key={k} onPress={() => pick(k)} disabled={answered} style={[styles.option, { borderColor: good ? P.green : bad ? P.red : P.border, backgroundColor: good ? P.greenSoft : bad ? P.redSoft : P.chip }]} accessibilityRole="button">
                    <Text style={{ flex: 1, color: P.text, fontFamily: F.label, fontSize: 14.5 * s, lineHeight: 20 * s }}>{o}</Text>
                    {good && <MaterialCommunityIcons name="check-circle" size={18 * s} color={P.green} />}
                    {bad && <MaterialCommunityIcons name="close-circle" size={18 * s} color={P.red} />}
                  </Pressable>
                );
              })}
            </View>
            {answered && (
              <View style={{ marginTop: 12, gap: 10 }}>
                <Text style={{ color: right ? P.green : P.red, fontFamily: F.head, fontSize: 14.5 * s, lineHeight: 20 * s }}>{right ? move.good : move.bad[picked] || 'Not this time. They got through.'}</Text>
                <Pressable onPress={next} style={[styles.cta, { backgroundColor: P.text }]} accessibilityRole="button">
                  <Text style={{ color: P.bg, fontFamily: F.head, fontSize: 14.5 * s }}>{right || lastMove ? 'See my score' : 'The attack goes on. Next move →'}</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        ) : (
          <Animated.View style={enterStyle}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={[styles.score, { borderColor: stars ? P.green : P.red }]}>
                <Text style={{ color: P.text, fontSize: 18 * s, letterSpacing: 1 }}>{'★'.repeat(stars) + '☆'.repeat(3 - stars)}</Text>
                <Text style={{ color: P.muted, fontFamily: F.head, fontSize: 11 * s, marginTop: 2 }}>+{reward?.xp ?? 0} XP</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: stars ? P.green : P.red, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.4 }}>{stars === 3 ? 'STOPPED AT THE DOOR' : stars ? 'YOU LIMITED THE DAMAGE' : 'BREACHED'}</Text>
                <Text style={{ color: P.text, fontFamily: dark ? F.brand : FS.display, fontSize: 19 * s, lineHeight: 24 * s, marginTop: 2 }}>
                  {stoppedStep !== null ? `You stopped it at step ${stoppedStep + 1}` : 'The attack won this time'}
                </Text>
                <Text style={{ color: P.muted, fontFamily: F.body, fontSize: 12.5 * s, lineHeight: 17 * s, marginTop: 2 }}>
                  {stoppedStep !== null ? `Everything after step ${stoppedStep + 1} never happened.` : 'Same as the real story. Play again and try another move.'}
                </Text>
              </View>
            </View>
            {!!reward?.badge && (
              <View style={[styles.badge, { borderColor: P.green, backgroundColor: P.greenSoft }]}>
                <Text style={{ fontSize: 22 * s }}>{BADGES[reward.badge].icon}</Text>
                <Text style={{ color: P.text, fontFamily: F.head, fontSize: 13.5 * s }}>Badge unlocked: {BADGES[reward.badge].name}</Text>
              </View>
            )}
            {explainer.checks.length === 3 && (
              <View style={{ marginTop: 18 }}>
                <Text style={{ color: P.muted, fontFamily: F.head, fontSize: 10.5 * s, letterSpacing: 1.4 }}>NOW CHECK YOUR REAL SETUP · {Math.round((yes / 3) * 100)}% READY</Text>
                <View style={{ gap: 8, marginTop: 8 }}>
                  {explainer.checks.map((q, k) => (
                    <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ flex: 1, color: P.text, fontFamily: F.body, fontSize: 13 * s, lineHeight: 18 * s }}>{q}</Text>
                      {(['Yes', 'Not yet'] as const).map((label, j) => {
                        const on = checks[k] === (j === 0);
                        const col = j === 0 ? P.green : '#F59E0B';
                        return (
                          <Pressable key={label} onPress={() => setChecks((c) => c.map((x, m) => (m === k ? j === 0 : x)))} style={[styles.yes, { borderColor: on ? col : P.border, backgroundColor: on ? col : 'transparent' }]}>
                            <Text style={{ color: on ? '#FFFFFF' : P.text, fontFamily: F.head, fontSize: 11.5 * s }}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <Pressable onPress={again} style={[styles.half, { borderColor: P.border, borderWidth: 1 }]} accessibilityRole="button">
                <Text style={{ color: P.text, fontFamily: F.head, fontSize: 13.5 * s }}>Play again</Text>
              </Pressable>
              <Pressable onPress={onClose} style={[styles.half, { backgroundColor: P.text }]} accessibilityRole="button">
                <Text style={{ color: P.bg, fontFamily: F.head, fontSize: 13.5 * s }}>Back to the chain</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const DK = { bg: '#07080D', text: '#F5F6FA', muted: 'rgba(245,246,250,0.6)', chip: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.16)', red: '#FF4D5E', redSoft: 'rgba(255,77,94,0.12)', redBorder: 'rgba(255,77,94,0.4)', green: '#4ADE80', greenSoft: 'rgba(74,222,128,0.14)' };
const LT = { bg: '#FAF7F1', text: '#1A1612', muted: '#6B6257', chip: '#FFFFFF', border: '#E0D8CB', red: '#C2261C', redSoft: '#FBEDEB', redBorder: '#EBC3BE', green: '#1F7A4D', greenSoft: '#E6F4EC' };

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  close: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginVertical: 12 },
  track: { position: 'absolute', left: 14, right: 14, height: 2, top: '50%', marginTop: -1 },
  node: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  situation: { marginTop: 8, padding: 13, borderRadius: 16, borderWidth: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 13, borderRadius: 14, borderWidth: 1.5 },
  cta: { height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  score: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 10, borderRadius: 14, borderWidth: 1 },
  yes: { height: 30, paddingHorizontal: 10, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  half: { flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
