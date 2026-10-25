import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { alertsAvailable, enableAlerts } from '../lib/notifications';
import { setPrefs, usePrefs } from '../lib/prefs';
import { detectRegion, type Region } from '../lib/region';
import { CARD_STYLES, F, type Palette, setCardStyle, setFollowPhone, setThemeChoice, THEMES, useCardStyle, useFollowPhone, useTheme, useThemeChoice } from '../theme';
import { STYLE_INFO, StylePreview, THEME_INFO, ThemePreview } from './Preferences';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const KEY = 'welcome-done';
/** True once the reader has finished or skipped the welcome (kept on the phone). */
export async function welcomeDone() {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true; // can't read the phone's storage: don't block the news
  }
}
const markDone = () => AsyncStorage.setItem(KEY, '1').catch(() => {});

const QUICK = ['Microsoft 365', 'Windows', 'Google Chrome', 'Android', 'iOS', 'WhatsApp', 'Fortinet', 'Cisco', 'VMware ESXi', 'Okta'];

/** Four short screens on first open: what CyberSid is, what you follow, how it looks, and alerts. Can be skipped. */
export function Welcome({ onDone }: { onDone: () => void }) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const prefs = usePrefs();
  const { width } = useWindowDimensions();
  const k = width >= 600 ? 1.25 : 1;
  const [step, setStep] = useState(0);
  const themeChoice = useThemeChoice();
  const followPhone = useFollowPhone();
  const cardStyle = useCardStyle();
  const LAST = 3;
  const region: Region = (prefs.region || detectRegion()) as Region;

  const finish = () => {
    markDone();
    onDone();
  };
  const toggle = (name: string) =>
    setPrefs({ products: prefs.products.includes(name) ? prefs.products.filter((p) => p !== name) : [...prefs.products, name] });
  const turnOnAlerts = async () => {
    setPrefs({ alerts: true });
    if (alertsAvailable) await enableAlerts(); // Android asks "Allow CyberSid to send notifications?"
    finish();
  };

  const point = (icon: IconName, title: string, text: string) => (
    <View style={styles.point} key={title}>
      <View style={styles.pointIcon}>
        <MaterialCommunityIcons name={icon} size={20 * k} color={C.brandDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.pointTitle, { fontSize: 15 * k }]}>{title}</Text>
        <Text style={[styles.pointText, { fontSize: 13.5 * k, lineHeight: 19 * k }]}>{text}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
          ))}
        </View>
        <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.skip, { fontSize: 14 * k }]}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.body, { maxWidth: 560 }]} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <>
            <Image source={require('../../assets/logo-mark.png')} style={{ width: 64 * k, height: 64 * k }} contentFit="contain" />
            <Text style={[styles.title, { fontSize: 28 * k, lineHeight: 34 * k }]}>Cyber security news in 60 seconds</Text>
            <Text style={[styles.lead, { fontSize: 15 * k, lineHeight: 22 * k }]}>
              Breaches, ransomware, scams and zero-days, explained simply.
            </Text>
            {point('gesture-swipe-up', 'Swipe up for the next story', 'Each card is one story. Tap the picture or "Read full story" for the whole article.')}
            {point('link-variant', 'See how the attack worked', 'Cards with a CHAIN tab show the attack step by step. Swipe left or tap CHAIN.')}
            {point('lightning-bolt', 'Zero-day and Critical stand out', 'The most serious stories are clearly marked, so you never miss them.')}
          </>
        )}

        {step === 1 && (
          <>
            <Text style={[styles.title, { fontSize: 26 * k, lineHeight: 32 * k }]}>Make it yours</Text>
            <Text style={[styles.lead, { fontSize: 15 * k, lineHeight: 22 * k }]}>Local news, scam tips and reporting links for where you are.</Text>
            <View style={styles.segment}>
              {(['GB', 'IN', 'INTL'] as Region[]).map((r) => {
                const on = region === r;
                return (
                  <Pressable key={r} onPress={() => setPrefs({ region: r })} style={[styles.segBtn, on && styles.segOn]} accessibilityState={{ selected: on }}>
                    <Text style={{ color: on ? C.onBrand : C.body, fontFamily: on ? F.label : F.medium, fontSize: 14 * k }}>
                      {r === 'GB' ? 'UK' : r === 'IN' ? 'India' : 'Worldwide'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.sub, { fontSize: 15 * k }]}>Products you use</Text>
            <Text style={[styles.pointText, { fontSize: 13.5 * k }]}>News about these goes in "For you" and comes first. You can add more any time in settings.</Text>
            <View style={styles.chips}>
              {QUICK.map((p) => {
                const on = prefs.products.includes(p);
                return (
                  <Pressable key={p} onPress={() => toggle(p)} style={[styles.chip, on && styles.chipOn]} accessibilityState={{ selected: on }}>
                    <MaterialCommunityIcons name={on ? 'check' : 'plus'} size={14} color={on ? C.onBrand : C.body} />
                    <Text style={{ color: on ? C.onBrand : C.text, fontFamily: F.medium, fontSize: 13.5 * k }}>{p}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={[styles.title, { fontSize: 26 * k, lineHeight: 32 * k }]}>Pick your look</Text>
            <Text style={[styles.lead, { fontSize: 15 * k, lineHeight: 22 * k }]}>Choose a theme, a card style, and whether you'd like games and the opening sound. You can change these any time in settings.</Text>
            <Text style={[styles.sub, { fontSize: 15 * k, marginTop: 4 }]}>Theme</Text>
            <View style={styles.grid}>
              {THEMES.map((t) => {
                const on = !followPhone && themeChoice === t;
                return (
                  <Pressable key={t} onPress={() => setThemeChoice(t)} style={[styles.tile, on && styles.tileOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${THEME_INFO[t].name} theme`}>
                    <ThemePreview theme={t} />
                    <View style={styles.tileRow}>
                      <Text style={{ color: C.text, fontFamily: F.head, fontSize: 14 * k }}>{THEME_INFO[t].name}</Text>
                      {on && <MaterialCommunityIcons name="check-circle" size={18} color={C.glass ? '#FFFFFF' : C.brand} />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.switchRow}>
              <Text style={{ flex: 1, color: C.text, fontFamily: F.medium, fontSize: 14 * k }}>Match my phone's light or dark mode</Text>
              <Switch testID="switch-follow-phone" value={followPhone} onValueChange={setFollowPhone} trackColor={{ true: C.glass ? '#34C759' : C.brand, false: C.border }} thumbColor="#FFFFFF" />
            </View>
            <Text style={[styles.sub, { fontSize: 15 * k }]}>Card style</Text>
            <View style={styles.grid}>
              {CARD_STYLES.map((t) => {
                const on = cardStyle === t;
                return (
                  <Pressable key={t} onPress={() => setCardStyle(t)} style={[styles.tile, on && styles.tileOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${STYLE_INFO[t].name} card style`}>
                    <StylePreview kind={t} />
                    <View style={styles.tileRow}>
                      <Text style={{ color: C.text, fontFamily: F.head, fontSize: 14 * k }}>{STYLE_INFO[t].name}</Text>
                      {on && <MaterialCommunityIcons name="check-circle" size={18} color={C.glass ? '#FFFFFF' : C.brand} />}
                    </View>
                    <Text style={{ color: C.muted, fontFamily: F.body, fontSize: 11.5 * k, lineHeight: 15 * k, marginTop: 2 }}>{STYLE_INFO[t].about}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.switchRow, { marginTop: 22 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontFamily: F.head, fontSize: 15 * k }}>Awareness games</Text>
                <Text style={{ color: C.muted, fontFamily: F.body, fontSize: 13 * k, marginTop: 2 }}>A 30 second game after some scam and safety stories</Text>
              </View>
              <Switch testID="switch-games" value={prefs.games} onValueChange={(v) => setPrefs({ games: v })} trackColor={{ true: C.glass ? '#34C759' : C.brand, false: C.border }} thumbColor="#FFFFFF" ios_backgroundColor={C.border} />
            </View>
            <View style={[styles.switchRow, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontFamily: F.head, fontSize: 15 * k }}>Opening sound</Text>
                <Text style={{ color: C.muted, fontFamily: F.body, fontSize: 13 * k, marginTop: 2 }}>A short sound with the logo when the app opens. Silent when your phone is on silent.</Text>
              </View>
              <Switch testID="switch-sound" value={prefs.sound} onValueChange={(v) => setPrefs({ sound: v })} trackColor={{ true: C.glass ? '#34C759' : C.brand, false: C.border }} thumbColor="#FFFFFF" ios_backgroundColor={C.border} />
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <View style={[styles.bigIcon, { width: 76 * k, height: 76 * k, borderRadius: 38 * k }]}>
              <MaterialCommunityIcons name="bell-ring-outline" size={36 * k} color={C.brandDark} />
            </View>
            <Text style={[styles.title, { fontSize: 26 * k, lineHeight: 32 * k }]}>Alerts only when it matters</Text>
            <Text style={[styles.lead, { fontSize: 15 * k, lineHeight: 22 * k }]}>
              We only send an alert for zero-days, Critical and High stories. Quiet from 10pm to 7am unless it's urgent.
            </Text>
            {point('shield-check-outline', 'No account, no tracking', 'Alerts use an anonymous address for your phone. Turn them off any time in settings.')}
          </>
        )}
      </ScrollView>

      <View style={[styles.bottom, { maxWidth: 560 }]}>
        {step < LAST ? (
          <Pressable onPress={() => setStep(step + 1)} style={styles.primary} accessibilityRole="button">
            <Text style={[styles.primaryText, { fontSize: 15.5 * k }]}>Next</Text>
          </Pressable>
        ) : (
          <>
            <Pressable onPress={turnOnAlerts} style={styles.primary} accessibilityRole="button">
              <Text style={[styles.primaryText, { fontSize: 15.5 * k }]}>Turn on alerts</Text>
            </Pressable>
            <Pressable onPress={() => { setPrefs({ alerts: false, alertsAsked: true }); finish(); }} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}>
              <Text style={[styles.skip, { fontSize: 14 * k }]}>Not now</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.glass ? '#121726' : C.bg },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 10 },
    dots: { flexDirection: 'row', gap: 6 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.border },
    dotOn: { width: 22, backgroundColor: C.brand },
    skip: { color: C.muted, fontFamily: F.label },
    body: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 24, alignSelf: 'center', width: '100%' },
    title: { color: C.text, fontFamily: F.head, letterSpacing: -0.5, marginTop: 18 },
    lead: { color: C.body, fontFamily: F.body, marginTop: 10, marginBottom: 18 },
    sub: { color: C.text, fontFamily: F.head, marginTop: 24 },
    point: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginTop: 16 },
    pointIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.glass ? C.surface : C.dark ? '#1E2638' : '#EEF2FF' },
    pointTitle: { color: C.text, fontFamily: F.label },
    pointText: { color: C.muted, fontFamily: F.body, marginTop: 3 },
    bigIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.glass ? C.surface : C.dark ? '#1E2638' : '#EEF2FF' },
    segment: { flexDirection: 'row', gap: 6, backgroundColor: C.glass ? C.surface : C.dark ? '#121722' : '#FFFFFF', borderRadius: 14, padding: 4, borderWidth: 1, borderColor: C.border },
    segBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10 },
    segOn: { backgroundColor: C.brand },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.chipBorder, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.glass ? 'transparent' : C.surface },
    chipOn: { backgroundColor: C.brand, borderColor: C.brand },
    bottom: { paddingHorizontal: 24, paddingBottom: 16, alignSelf: 'center', width: '100%' },
    primary: { backgroundColor: C.brand, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
    primaryText: { color: C.onBrand, fontFamily: F.label },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
    tile: { width: '47.5%', flexGrow: 1, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 7, paddingBottom: 10, backgroundColor: C.glass ? 'rgba(255,255,255,0.06)' : C.dark ? '#121722' : '#FFFFFF' },
    tileOn: { borderColor: C.glass ? '#FFFFFF' : C.brand, borderWidth: 2 },
    tileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  });
