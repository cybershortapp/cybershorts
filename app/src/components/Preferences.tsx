import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { disableAlerts, enableAlerts, syncAlerts } from '../lib/notifications';
import { cleanTerm, setPrefs, usePrefs } from '../lib/prefs';
import { PRODUCTS } from '../lib/products';
import { supabase } from '../lib/supabase';
import { C, F } from '../theme';

const POPULAR = ['Microsoft Defender', 'Mimecast', 'Microsoft 365', 'Windows', 'Fortinet', 'Cisco', 'Okta', 'Google Chrome', 'VMware ESXi', 'Citrix NetScaler'];

type Props = { onDone: () => void };

export function Preferences({ onDone }: Props) {
  const prefs = usePrefs();
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

  const toggleAlerts = async (on: boolean) => {
    if (on) {
      setPrefs({ alerts: true });
      const ok = await enableAlerts();
      if (!ok) setPrefs({ alerts: false });
    } else {
      await disableAlerts();
    }
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
                At most one an hour: your products first, then the most serious news. Quiet from 10pm to 7am unless it's critical.
              </Text>
            </View>
            <Switch value={prefs.alerts} onValueChange={toggleAlerts} trackColor={{ true: C.brand, false: C.border }} thumbColor={C.white} />
          </View>
        </View>

        {/* 3. email */}
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
          {emailState === 'error' && <Text style={[styles.note, { color: '#C62F2E' }]}>That email doesn't look right, or you're offline. Please try again.</Text>}
        </View>

        <Text style={[styles.small, { textAlign: 'center', marginTop: 6 }]}>
          Your products are saved on this phone. They're only sent to us to match your alerts and emails.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 8 },
  title: { fontFamily: F.brand, color: C.text },
  done: { backgroundColor: C.brand, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7 },
  panel: { backgroundColor: C.white, borderWidth: 1, borderColor: C.border, borderRadius: 16, padding: 16, marginBottom: 12 },
  h: { fontFamily: F.head, color: C.text },
  p: { color: C.body, lineHeight: 20, marginTop: 4 },
  small: { color: C.muted, fontFamily: F.label, fontSize: 12, letterSpacing: 0.8, marginTop: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.borderSoft, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 12, marginTop: 12 },
  input: { flex: 1, color: C.text, paddingVertical: 11 },
  suggest: { borderWidth: 1, borderColor: C.border, borderRadius: 12, marginTop: 6, overflow: 'hidden' },
  sRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.imageBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOff: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.chipBorder, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: { marginTop: 10, backgroundColor: C.brand, borderWidth: 1, borderColor: C.brand, borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  note: { fontSize: 13, marginTop: 8, lineHeight: 18 },
});
