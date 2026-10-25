import { MaterialCommunityIcons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { lastError, type AppError } from '../lib/crash';
import { alertsAvailable, alertsConnected, alertsProblem, disableAlerts, enableAlerts, syncAlerts } from '../lib/notifications';
import { cleanTerm, setPrefs, usePrefs } from '../lib/prefs';
import { PRODUCTS } from '../lib/products';
import { detectRegion, REGION_NAMES, type Region } from '../lib/region';
import { supabase } from '../lib/supabase';
import { CARD_STYLES, type CardStyle, F, FS, type Palette, setCardStyle, setFollowPhone, setThemeChoice, THEMES, type ThemeChoice, useCardStyle, useFollowPhone, useTheme, useThemeChoice } from '../theme';

const POPULAR = ['Microsoft Defender', 'Mimecast', 'Microsoft 365', 'Windows', 'Fortinet', 'Cisco', 'Okta', 'Google Chrome', 'VMware ESXi', 'Citrix NetScaler'];

type Props = { onDone: () => void; onShowWelcome?: () => void };

export function Preferences({ onDone, onShowWelcome }: Props) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const prefs = usePrefs();
  const themeChoice = useThemeChoice();
  const followPhone = useFollowPhone();
  const cardStyle = useCardStyle();
  const { width } = useWindowDimensions();
  const isTablet = width >= 600;
  const w = Math.min(width - (isTablet ? 48 : 24), 680);
  const s = isTablet ? 1.3 : 1;
  const [q, setQ] = useState('');
  const [email, setEmail] = useState(prefs.email);
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'error'>(prefs.email ? 'sent' : 'idle');

  const chosen = new Set([...prefs.products, ...prefs.terms].map((x) => x.toLowerCase()));

  // suggestions as you type: names first, then aliases (e.g. "defender" finds Microsoft Defender)
  const suggestions = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const starts = PRODUCTS.filter((p) => p.name.toLowerCase().startsWith(t) || p.aliases.some((a) => a.startsWith(t)));
    const contains = PRODUCTS.filter((p) => !starts.includes(p) && (p.name.toLowerCase().includes(t) || p.aliases.some((a) => a.includes(t))));
    return [...starts, ...contains].filter((p) => !chosen.has(p.name.toLowerCase())).slice(0, 6);
  }, [q, prefs.products, prefs.terms]); // eslint-disable-line react-hooks/exhaustive-deps

  const exact = PRODUCTS.some((p) => p.name.toLowerCase() === q.trim().toLowerCase());
  const keyword = cleanTerm(q);

  const save = (products: string[], terms: string[]) => {
    setPrefs({ products, terms });
    syncAlerts();
    // already subscribed by email: keep the email digest in step too
    if (prefs.email) supabase.rpc('subscribe_email', { p_email: prefs.email, p_products: products, p_terms: terms }).then(() => {}, () => {});
  };
  const addProduct = (name: string) => {
    save([...prefs.products, name], prefs.terms);
    setQ('');
  };
  const addKeyword = () => {
    if (keyword.length < 2 || chosen.has(keyword.toLowerCase())) return;
    save(prefs.products, [...prefs.terms, keyword]);
    setQ('');
  };
  // Enter key: exact product name, else the top suggestion, else add what they typed as a keyword
  const submit = () => {
    const t = q.trim().toLowerCase();
    const hit = PRODUCTS.find((p) => p.name.toLowerCase() === t) ?? suggestions[0];
    if (hit && !chosen.has(hit.name.toLowerCase())) addProduct(hit.name);
    else addKeyword();
  };
  const remove = (x: string) => save(prefs.products.filter((p) => p !== x), prefs.terms.filter((t) => t !== x));

  const [appError, setAppError] = useState<AppError | null>(null);
  useEffect(() => {
    lastError().then(setAppError);
  }, []);
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState('');
  const [connected, setConnected] = useState(alertsConnected());
  const connect = async () => {
    setBlocked(false);
    setProblem('');
    const t = await enableAlerts();
    setConnected(!!t);
    if (!t) {
      const why = alertsProblem();
      if (why === 'blocked') setBlocked(true);
      else setProblem(why || 'Could not connect this phone for alerts.');
    }
  };
  // opening Preferences: make sure this phone is connected (asks once if Android needs permission)
  useEffect(() => {
    if (!alertsAvailable || !prefs.alerts) return;
    connect();
  }, [prefs.alerts]);
  // the switch always keeps the reader's choice; if Android has blocked notifications we offer the settings page
  const toggleAlerts = async (on: boolean) => {
    setBlocked(false);
    setProblem('');
    if (!on) {
      await disableAlerts();
      return;
    }
    setPrefs({ alerts: true }); // the effect above then connects this phone
  };

  const subscribe = async () => {
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) {
      setEmailState('error');
      return;
    }
    Keyboard.dismiss();
    setEmailState('sending');
    const { error } = await supabase.rpc('subscribe_email', { p_email: e, p_products: prefs.products, p_terms: prefs.terms });
    if (error) {
      setEmailState('error');
      return;
    }
    setPrefs({ email: e });
    setEmailState('sent');
  };

  const all = [...prefs.products, ...prefs.terms];

  return (
    <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <View style={{ width: w }}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { fontSize: 22 * s }]}>Preferences</Text>
          <Pressable onPress={onDone} hitSlop={10} style={styles.done} accessibilityRole="button">
            <Text style={{ color: C.onBrand, fontFamily: F.label, fontSize: 14 * s }}>Done</Text>
          </Pressable>
        </View>

        {/* 1. products */}
        <View style={styles.panel}>
          <Text style={[styles.h, { fontSize: 16 * s }]}>Products you use</Text>
          <Text style={[styles.p, { fontSize: 13.5 * s }]}>
            News about these shows in "For you", and they come first in your alerts and emails.
          </Text>
          <View style={styles.inputRow}>
            <MaterialCommunityIcons name="magnify" size={20} color={C.muted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              onSubmitEditing={submit}
              placeholder="Type a product, e.g. Defender, Mimecast"
              placeholderTextColor={C.muted}
              style={[styles.input, { fontSize: 15 * s }]}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="done"
              maxLength={40}
            />
          </View>
          {(suggestions.length > 0 || (keyword.length >= 2 && !exact)) && (
            <View style={styles.suggest}>
              {suggestions.map((p) => (
                <Pressable key={p.name} onPress={() => addProduct(p.name)} style={({ pressed }) => [styles.sRow, pressed && { backgroundColor: C.card }]}>
                  <MaterialCommunityIcons name="plus-circle-outline" size={18} color={C.brand} />
                  <Text style={{ fontSize: 15 * s, color: C.text, flex: 1 }}>{p.name}</Text>
                  {p.vendor !== p.name && <Text style={{ fontSize: 12.5 * s, color: C.muted }}>{p.vendor}</Text>}
                </Pressable>
              ))}
              {keyword.length >= 2 && !exact && !chosen.has(keyword.toLowerCase()) && (
                <Pressable onPress={addKeyword} style={({ pressed }) => [styles.sRow, pressed && { backgroundColor: C.card }]}>
                  <MaterialCommunityIcons name="text-search" size={18} color={C.purple} />
                  <Text style={{ fontSize: 15 * s, color: C.text, flex: 1 }}>
                    Add "<Text style={{ fontFamily: F.label }}>{keyword}</Text>" as a keyword
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {all.length > 0 ? (
            <View style={styles.chips}>
              {all.map((x) => (
                <Pressable key={x} onPress={() => remove(x)} style={styles.chip} accessibilityLabel={`Remove ${x}`}>
                  <Text style={{ color: C.brandText, fontFamily: F.medium, fontSize: 13.5 * s }}>{x}</Text>
                  <MaterialCommunityIcons name="close" size={14} color={C.brandText} />
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              <Text style={[styles.small, { fontSize: 12.5 * s }]}>POPULAR</Text>
              <View style={styles.chips}>
                {POPULAR.map((x) => (
                  <Pressable key={x} onPress={() => addProduct(x)} style={styles.chipOff}>
                    <MaterialCommunityIcons name="plus" size={14} color={C.body} />
                    <Text style={{ color: C.body, fontSize: 13.5 * s }}>{x}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>

        {/* 2. alerts */}
        <View style={styles.panel}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.h, { fontSize: 16 * s }]}>Phone alerts</Text>
              <Text style={[styles.p, { fontSize: 13.5 * s }]}>
                Alerts for zero-days, Critical and High stories. Quiet from 10pm to 7am unless it's urgent; the night's news comes in one alert at 7am.
              </Text>
            </View>
            <Switch testID="switch-alerts" value={prefs.alerts} onValueChange={toggleAlerts} trackColor={{ true: C.glass ? '#34C759' : C.brand, false: C.border }} thumbColor="#FFFFFF" ios_backgroundColor={C.border} />
          </View>
          {alertsAvailable && prefs.alerts && !blocked && !problem && (
            <View style={[styles.statusRow, { backgroundColor: connected ? C.imageBg : C.card }]}>
              <MaterialCommunityIcons name={connected ? 'check-circle' : 'progress-clock'} size={16} color={connected ? C.brand : C.muted} />
              <Text style={{ color: connected ? C.brandText : C.muted, fontSize: 13 * s, flex: 1 }}>
                {connected ? 'This phone is set up for alerts.' : 'Connecting this phone for alerts...'}
              </Text>
            </View>
          )}
          {!!problem && prefs.alerts && (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.note, { color: C.danger, marginTop: 0 }]} selectable>
                Alerts not connected. {problem}
              </Text>
              <Pressable onPress={connect} style={[styles.btn, { marginTop: 8 }]}>
                <Text style={{ color: C.onBrand, fontFamily: F.label, fontSize: 14.5 * s }}>Try again</Text>
              </Pressable>
            </View>
          )}
          {!alertsAvailable && (
            <Text style={[styles.note, { color: C.muted }]}>Alerts work in the installed app, not in this test preview.</Text>
          )}
          {blocked && (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.note, { color: C.danger, marginTop: 0 }]}>Notifications are turned off for CyberSid in your phone settings.</Text>
              <Pressable onPress={() => Linking.openSettings()} style={[styles.btn, { marginTop: 8 }]}>
                <Text style={{ color: C.onBrand, fontFamily: F.label, fontSize: 14.5 * s }}>Open phone settings</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* region: local news, tips and report links */}
        <View style={styles.panel}>
          <Text style={[styles.h, { fontSize: 16 * s }]}>Your region</Text>
          <Text style={[styles.p, { fontSize: 13.5 * s }]}>
            You get world news plus local news, tips and scam reporting links for your country.
            {!prefs.region ? ` Set from your phone: ${REGION_NAMES[detectRegion()]}.` : ''}
          </Text>
          <View style={styles.segment}>
            {(['GB', 'IN', 'INTL'] as Region[]).map((r) => {
              const on = (prefs.region || detectRegion()) === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => {
                    setPrefs({ region: r });
                    syncAlerts();
                  }}
                  style={[styles.segBtn, on && { backgroundColor: C.brand }]}
                  accessibilityState={{ selected: on }}
                >
                  <MaterialCommunityIcons name={r === 'INTL' ? 'earth' : 'map-marker-outline'} size={16} color={on ? C.onBrand : C.body} />
                  <Text style={{ color: on ? C.onBrand : C.body, fontFamily: on ? F.label : F.medium, fontSize: 13.5 * s }}>
                    {r === 'GB' ? 'UK' : r === 'IN' ? 'India' : 'Worldwide'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 2b. games */}
        <View style={styles.panel}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.h, { fontSize: 16 * s }]}>Awareness games</Text>
              <Text style={[styles.p, { fontSize: 13.5 * s }]}>
                A 30 second game after some scam and safety stories. At most 3 a day, never the same one twice.
              </Text>
            </View>
            <Switch testID="switch-games" value={prefs.games} onValueChange={(v) => setPrefs({ games: v })} trackColor={{ true: C.glass ? '#34C759' : C.brand, false: C.border }} thumbColor="#FFFFFF" ios_backgroundColor={C.border} />
          </View>
        </View>

        {/* 2c. opening sound */}
        <View style={styles.panel}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.h, { fontSize: 16 * s }]}>Opening sound</Text>
              <Text style={[styles.p, { fontSize: 13.5 * s }]}>A short sound with the logo when the app opens. Always silent when your phone is on silent.</Text>
            </View>
            <Switch testID="switch-sound" value={prefs.sound} onValueChange={(v) => setPrefs({ sound: v })} trackColor={{ true: C.glass ? '#34C759' : C.brand, false: C.border }} thumbColor="#FFFFFF" ios_backgroundColor={C.border} />
          </View>
        </View>

        {/* 3. appearance */}
        <View style={styles.panel}>
          <Text style={[styles.h, { fontSize: 16 * s }]}>Look and feel</Text>
          <View style={styles.themeGrid}>
            {THEMES.map((t) => {
              const on = !followPhone && themeChoice === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setThemeChoice(t)}
                  style={[styles.themeTile, on && { borderColor: C.glass ? '#FFFFFF' : C.brand, borderWidth: 2 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${THEME_INFO[t].name} theme`}
                >
                  <ThemePreview theme={t} />
                  <View style={styles.themeNameRow}>
                    <Text style={{ color: C.text, fontFamily: F.head, fontSize: 14 * s }}>{THEME_INFO[t].name}</Text>
                    {on && <MaterialCommunityIcons name="check-circle" size={18} color={C.glass ? '#FFFFFF' : C.brand} />}
                  </View>
                  <Text style={{ color: C.muted, fontFamily: F.body, fontSize: 11.5 * s, lineHeight: 15 * s, marginTop: 2 }}>{THEME_INFO[t].about}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.switchRow, { marginTop: 14 }]}>
            <Text style={{ flex: 1, color: C.text, fontFamily: F.medium, fontSize: 14 * s }}>Match my phone's light or dark mode</Text>
            <Switch testID="switch-follow-phone" value={followPhone} onValueChange={setFollowPhone} trackColor={{ true: C.glass ? '#34C759' : C.brand, false: C.border }} thumbColor="#FFFFFF" />
          </View>
          <Text style={{ color: C.muted, fontFamily: F.body, fontSize: 12 * s, marginTop: 6, lineHeight: 17 * s }}>
            When this is on, the app switches between Light and Dark with your phone.
          </Text>
        </View>

        {/* 3b. card style */}
        <View style={styles.panel}>
          <Text style={[styles.h, { fontSize: 16 * s }]}>Card style</Text>
          <Text style={[styles.p, { fontSize: 13.5 * s }]}>How each story looks. Works with any theme.</Text>
          <View style={styles.themeGrid}>
            {CARD_STYLES.map((t) => {
              const on = cardStyle === t;
              return (
                <Pressable
                  key={t}
                  onPress={() => setCardStyle(t)}
                  style={[styles.themeTile, on && { borderColor: C.glass ? '#FFFFFF' : C.brand, borderWidth: 2 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${STYLE_INFO[t].name} card style`}
                >
                  <StylePreview kind={t} />
                  <View style={styles.themeNameRow}>
                    <Text style={{ color: C.text, fontFamily: F.head, fontSize: 14 * s }}>{STYLE_INFO[t].name}</Text>
                    {on && <MaterialCommunityIcons name="check-circle" size={18} color={C.glass ? '#FFFFFF' : C.brand} />}
                  </View>
                  <Text style={{ color: C.muted, fontFamily: F.body, fontSize: 11.5 * s, lineHeight: 15 * s, marginTop: 2 }}>{STYLE_INFO[t].about}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 4. email */}
        <View style={styles.panel}>
          <Text style={[styles.h, { fontSize: 16 * s }]}>Daily email</Text>
          <Text style={[styles.p, { fontSize: 13.5 * s }]}>
            One email each morning with news about your products and the top stories. Unsubscribe any time.
          </Text>
          <View style={[styles.inputRow, { marginTop: 10 }]}>
            <MaterialCommunityIcons name="email-outline" size={20} color={C.muted} />
            <TextInput
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                if (emailState !== 'sending') setEmailState('idle');
              }}
              placeholder="you@example.com"
              placeholderTextColor={C.muted}
              style={[styles.input, { fontSize: 15 * s }]}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={254}
            />
          </View>
          <Pressable
            onPress={subscribe}
            disabled={emailState === 'sending'}
            style={[styles.btn, emailState === 'sent' && { backgroundColor: C.card, borderColor: C.borderSoft }]}
          >
            <Text style={{ color: emailState === 'sent' ? C.brandText : C.onBrand, fontFamily: F.label, fontSize: 14.5 * s }}>
              {emailState === 'sending' ? 'Subscribing...' : emailState === 'sent' ? 'Update my email preferences' : 'Subscribe'}
            </Text>
          </Pressable>
          {emailState === 'sent' && (
            <Text style={[styles.note, { color: C.brandText }]}>Check your inbox and tap the link to confirm. Emails start after that.</Text>
          )}
          {emailState === 'error' && <Text style={[styles.note, { color: C.danger }]}>That email doesn't look right, or you're offline. Please try again.</Text>}
        </View>

        <Text style={[styles.small, { textAlign: 'center', marginTop: 6 }]}>
          Your products are saved on this phone. They're only sent to us to match your alerts and emails.
        </Text>
        <Pressable
          onPress={() => Linking.openURL('https://cybershortapp.github.io/cybershorts/').catch(() => {})}
          hitSlop={8}
          style={{ alignSelf: 'center', marginTop: 12 }}
          accessibilityRole="link"
        >
          <Text style={{ color: C.brandDark, fontFamily: F.label, fontSize: 13.5 * s }}>About CyberSid, privacy and contact</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Linking.openURL(
              `mailto:cybershort.app@gmail.com?subject=${encodeURIComponent(`CyberSid feedback (version ${Constants.expoConfig?.version ?? ''})`)}`,
            ).catch(() => {})
          }
          hitSlop={8}
          style={{ alignSelf: 'center', marginTop: 12 }}
          accessibilityRole="link"
        >
          <Text style={{ color: C.brandDark, fontFamily: F.label, fontSize: 13.5 * s }}>Send feedback</Text>
        </Pressable>
        {!!onShowWelcome && (
          <Pressable onPress={onShowWelcome} hitSlop={8} style={{ alignSelf: 'center', marginTop: 12 }} accessibilityRole="button">
            <Text style={{ color: C.brandDark, fontFamily: F.label, fontSize: 13.5 * s }}>How CyberSid works</Text>
          </Pressable>
        )}
        {!!appError && (
          <Text style={[styles.small, { textAlign: 'center', marginTop: 10, opacity: 0.7 }]} selectable>
            Last app problem ({new Date(appError.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}): {appError.message}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

export const THEME_INFO: Record<ThemeChoice, { name: string; about: string }> = {
  vivid: { name: 'Vivid', about: 'Each story takes the colours of its picture' },
  aurora: { name: 'Aurora', about: 'CyberSid blue and purple glow behind glass' },
  light: { name: 'Light', about: 'Clean white cards' },
  dark: { name: 'Dark', about: 'Easy on the eyes at night' },
};

/** A small drawing of each theme, so readers can see it before they pick it. */
export function ThemePreview({ theme }: { theme: ThemeChoice }) {
  const bar = (top: number, width: string, colour: string, height = 6) => (
    <View style={{ position: 'absolute', left: 10, top, width: width as `${number}%`, height, borderRadius: 3, backgroundColor: colour }} />
  );
  if (theme === 'vivid') {
    return (
      <View style={[prev.box, { backgroundColor: '#3a0d12' }]}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 52, backgroundColor: '#7a1a22' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 30, height: 30, backgroundColor: '#3a0d12', opacity: 0.6 }} />
        {bar(62, '72%', '#FFFFFF')}
        {bar(73, '50%', '#FFFFFF')}
        {bar(86, '82%', 'rgba(255,255,255,0.45)', 4)}
      </View>
    );
  }
  if (theme === 'aurora') {
    return (
      <View style={prev.box}>
        <Image source={require('../../assets/aurora.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={{ position: 'absolute', left: 6, right: 6, top: 8, bottom: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }} />
        {bar(56, '64%', '#FFFFFF')}
        {bar(67, '44%', '#FFFFFF')}
        {bar(80, '70%', 'rgba(255,255,255,0.5)', 4)}
      </View>
    );
  }
  const dark = theme === 'dark';
  return (
    <View style={[prev.box, { backgroundColor: dark ? '#000000' : '#F2F2F7', padding: 6 }]}>
      <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: dark ? '#1C1C1E' : '#FFFFFF' }}>
        <View style={{ height: 40, backgroundColor: dark ? '#2C3348' : '#D6E0FF' }} />
      </View>
      {bar(56, '64%', dark ? '#F5F5F7' : '#1D1D1F')}
      {bar(67, '44%', dark ? '#F5F5F7' : '#1D1D1F')}
      {bar(80, '70%', dark ? '#48484A' : '#D1D1D6', 4)}
    </View>
  );
}

export const STYLE_INFO: Record<CardStyle, { name: string; about: string }> = {
  standard: { name: 'Standard', about: 'Picture on top, story below' },
  magazine: { name: 'Magazine', about: 'A full cover; scroll to read the article' },
  newspaper: { name: 'Newspaper', about: 'A front page with a classic serif look' },
  terminal: { name: 'Terminal', about: 'The story as a hacker terminal' },
  ronin: { name: 'Ronin', about: 'Ink on rice paper, a red seal and a sword slash' },
};

/** A small drawing of each card style. */
export function StylePreview({ kind }: { kind: CardStyle }) {
  if (kind === 'magazine') {
    return (
      <View style={[prev.box, { backgroundColor: '#000' }]}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 60, backgroundColor: '#5b2a7a' }} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 36, height: 26, backgroundColor: '#000', opacity: 0.6 }} />
        <View style={{ position: 'absolute', left: 10, top: 58, width: '75%', height: 8, borderRadius: 3, backgroundColor: '#fff' }} />
        <View style={{ position: 'absolute', left: 10, top: 70, width: '55%', height: 8, borderRadius: 3, backgroundColor: '#fff' }} />
        <View style={{ position: 'absolute', left: 10, top: 86, width: '80%', height: 4, borderRadius: 2, backgroundColor: '#888' }} />
      </View>
    );
  }
  if (kind === 'newspaper') {
    return (
      <View style={[prev.box, { backgroundColor: '#F6F1E4', alignItems: 'center', paddingTop: 6 }]}>
        <Text style={{ fontFamily: FS.masthead, fontSize: 13, color: '#141210' }}>The CyberSid Times</Text>
        <View style={{ height: 1.5, alignSelf: 'stretch', marginHorizontal: 8, backgroundColor: '#141210', marginTop: 3 }} />
        <Text style={{ fontFamily: FS.display, fontSize: 12, color: '#141210', marginTop: 5 }}>Big headline</Text>
        <View style={{ width: '70%', height: 26, backgroundColor: '#8f8a80', marginTop: 5 }} />
        <View style={{ width: '80%', height: 3, backgroundColor: '#555', marginTop: 6 }} />
        <View style={{ width: '80%', height: 3, backgroundColor: '#555', marginTop: 3 }} />
      </View>
    );
  }
  if (kind === 'ronin') {
    return (
      <View style={[prev.box, { backgroundColor: '#EFE6D2', padding: 8 }]}>
        <View style={{ height: 40, backgroundColor: '#8f857a' }} />
        <View style={{ position: 'absolute', right: 10, top: 34, width: 22, height: 22, borderRadius: 4, backgroundColor: '#B3261E', alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] }}>
          <Text style={{ color: '#FFF4EA', fontSize: 11, fontFamily: FS.ink }}>危</Text>
        </View>
        <Text style={{ fontFamily: FS.ink, fontSize: 13, color: '#16120E', marginTop: 8 }} numberOfLines={1}>Ink and steel</Text>
        <View style={{ height: 2, width: '75%', backgroundColor: '#16120E', marginTop: 4, marginLeft: -8 }} />
        <View style={{ height: 3, width: '85%', backgroundColor: '#7a7064', marginTop: 7, borderRadius: 2 }} />
      </View>
    );
  }
  if (kind === 'terminal') {
    return (
      <View style={[prev.box, { backgroundColor: '#05070A', padding: 8 }]}>
        <Text style={{ fontFamily: FS.mono, fontSize: 9, color: '#4ADE80' }}>~$ news --latest</Text>
        <View style={{ borderWidth: 1, borderColor: '#2A3D32', borderRadius: 4, padding: 5, marginTop: 5 }}>
          <Text style={{ fontFamily: FS.monoBold, fontSize: 9.5, color: '#fff' }} numberOfLines={2}>Critical flaw under attack</Text>
        </View>
        <Text style={{ fontFamily: FS.mono, fontSize: 8.5, color: '#E9FFF0', marginTop: 5 }} numberOfLines={2}>
          Attackers can run <Text style={{ color: '#FFB86B' }}>code</Text> on <Text style={{ color: '#7DD3FC' }}>CVE-2026</Text>
        </Text>
      </View>
    );
  }
  return (
    <View style={[prev.box, { backgroundColor: '#F2F2F7', padding: 6 }]}>
      <View style={{ flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>
        <View style={{ height: 40, backgroundColor: '#D6E0FF' }} />
        <View style={{ marginLeft: 8, marginTop: 8, width: '70%', height: 6, borderRadius: 3, backgroundColor: '#1D1D1F' }} />
        <View style={{ marginLeft: 8, marginTop: 5, width: '45%', height: 6, borderRadius: 3, backgroundColor: '#1D1D1F' }} />
        <View style={{ marginLeft: 8, marginTop: 7, width: '80%', height: 4, borderRadius: 2, backgroundColor: '#D1D1D6' }} />
      </View>
    </View>
  );
}

const prev = StyleSheet.create({
  box: { height: 100, borderRadius: 12, overflow: 'hidden' },
});

const makeStyles = (C: Palette) =>
  StyleSheet.create({
  themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  themeTile: { width: '47.5%', flexGrow: 1, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 7, paddingBottom: 10, backgroundColor: C.glass ? 'rgba(255,255,255,0.06)' : C.dark ? '#121722' : '#FFFFFF' },
  themeNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  title: { fontFamily: F.brand, color: C.text },
  done: { backgroundColor: C.brand, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  panel: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  h: { fontFamily: F.head, color: C.text },
  p: { color: C.body, lineHeight: 20, marginTop: 4, fontFamily: F.body },
  small: { color: C.muted, fontFamily: F.label, fontSize: 12, letterSpacing: 0.8, marginTop: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.borderSoft, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 12, marginTop: 12 },
  input: { flex: 1, color: C.text, paddingVertical: 11, fontFamily: F.body },
  suggest: { borderWidth: 1, borderColor: C.border, borderRadius: 12, marginTop: 6, overflow: 'hidden' },
  sRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.imageBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOff: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.chipBorder, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: { marginTop: 10, backgroundColor: C.brand, borderWidth: 1, borderColor: C.brand, borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  note: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 10 },
  segment: { flexDirection: 'row', gap: 6, marginTop: 12, backgroundColor: C.card, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: C.border },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 9 },
});
