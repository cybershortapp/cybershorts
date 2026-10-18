import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { memo, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { chainLink } from '../lib/actions';
import { cleanGroup } from '../lib/clean';
import { supabase } from '../lib/supabase';
import type { ChainStep, Story, ThreatGroup } from '../lib/types';
import { DARK_PALETTE, F, LIGHT_PALETTE, type Palette, useTheme } from '../theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type Props = { story: Story; scale: number; width: number; onBack: () => void; bg?: string; look?: 'light' | 'dark' };
type Kit = ReturnType<typeof kit>;

/** Colours for the chain page, from the reader's theme: glass on the story's own colour (Vivid, Aurora),
 *  or plain light / dark. Built from plain views only (no measuring, no SVG) so it opens instantly. */
function kit(C: Palette, bg?: string) {
  const glass = C.glass;
  return {
    bg: bg ?? (glass ? 'transparent' : C.dark ? '#121722' : '#FFFFFF'),
    panel: glass ? 'rgba(255,255,255,0.09)' : C.dark ? '#1C2333' : '#F3F4F8',
    panelBorder: glass ? 'rgba(255,255,255,0.14)' : C.dark ? '#283149' : '#E3E6EE',
    line: glass ? 'rgba(255,255,255,0.14)' : C.border,
    red: glass || C.dark ? '#FF5A4E' : '#D92D20',
    redSoft: glass || C.dark ? '#FF8A80' : '#D92D20',
    text: C.text,
    body: glass ? 'rgba(255,255,255,0.78)' : C.body,
    muted: glass ? 'rgba(255,255,255,0.5)' : C.muted,
  };
}

const STAGE_ICON: Record<string, IconName> = {
  Reconnaissance: 'binoculars',
  'Resource Development': 'hammer-wrench',
  'Initial Access': 'door-open',
  Execution: 'console',
  Persistence: 'anchor',
  'Privilege Escalation': 'account-arrow-up-outline',
  Stealth: 'incognito',
  'Defense Impairment': 'shield-off-outline',
  'Credential Access': 'key-chain-variant',
  Discovery: 'radar',
  'Lateral Movement': 'transit-connection-variant',
  Collection: 'folder-zip-outline',
  'Command and Control': 'access-point-network',
  Exfiltration: 'cloud-upload-outline',
  Impact: 'lock-alert-outline',
};
const HOT = new Set(['Initial Access', 'Impact', 'Exfiltration']);
const iconFor = (stage: string): IconName => STAGE_ICON[stage] ?? 'shield-outline';


/** The whole attack at a glance: one icon per step, joined left to right. */
function AttackPath({ steps, s, K }: { steps: ChainStep[]; s: number; K: Kit }) {
  const size = (steps.length > 7 ? 26 : 32) * s;
  const out: React.ReactNode[] = [];
  steps.forEach((st, i) => {
    const hot = HOT.has(st.stage);
    if (i > 0) out.push(<View key={`l${i}`} style={{ flex: 1, minWidth: 4, height: 2, backgroundColor: K.red, opacity: 0.45 }} />);
    out.push(
      <View key={i} style={[styles.pathDot, { width: size, height: size, borderRadius: size / 2, backgroundColor: hot ? K.red : K.panel, borderColor: K.red }]}>
        <MaterialCommunityIcons name={iconFor(st.stage)} size={size * 0.5} color={hot ? '#FFFFFF' : K.redSoft} />
      </View>,
    );
  });
  // spread across the full width, so the whole attack fits on one line
  return <View style={[styles.row, { alignItems: 'center', paddingVertical: 4 }]}>{out}</View>;
}

function StepRow({ step, index, last, s, articleUrl, K }: {
  step: ChainStep; index: number; last: boolean; s: number; articleUrl: string; K: Kit;
}) {
  const hot = HOT.has(step.stage);
  const mitre = chainLink(step);
  const fromArticle = !step.source || step.source === 'article';
  const sourceUrl = fromArticle ? articleUrl : step.source_url;
  const dot = 14 * s;

  return (
    <View style={styles.row}>
      {/* left rail: a glowing dot for each step, joined by a thin line */}
      <View style={{ width: 26 * s, alignItems: 'center' }}>
        <View
          style={{
            width: dot, height: dot, borderRadius: dot / 2, marginTop: 4 * s, borderWidth: 2, borderColor: K.red,
            backgroundColor: hot ? K.red : K.bg === 'transparent' ? 'rgba(0,0,0,0.25)' : K.bg,
            shadowColor: K.red, shadowOpacity: hot ? 0.9 : 0, shadowRadius: 8, elevation: hot ? 6 : 0,
          }}
        />
        {!last && <View style={{ flex: 1, width: 1.5, backgroundColor: K.red, opacity: 0.35, marginTop: 3 }} />}
      </View>

      <View
        style={[
          { flex: 1, marginLeft: 8 * s, marginBottom: last ? 4 : 14 * s },
          hot && { backgroundColor: K.panel, borderColor: K.panelBorder, borderWidth: 1, borderRadius: 16, padding: 12 * s, marginTop: -8 * s },
        ]}
      >
        <View style={styles.inline}>
          <MaterialCommunityIcons name={iconFor(step.stage)} size={14 * s} color={K.redSoft} />
          <Text style={{ color: K.muted, fontSize: 12.5 * s, fontFamily: F.label, flexShrink: 1 }}>
            Step {index + 1}, {step.stage.toLowerCase()}
          </Text>
        </View>
        <Text style={{ color: K.text, fontSize: 15.5 * s, lineHeight: 22 * s, marginTop: 4 * s, fontFamily: F.medium }}>{step.detail}</Text>
        <View style={[styles.inline, { marginTop: 6 * s, gap: 14 * s }]}>
          {!!sourceUrl && (
            <Pressable onPress={() => Linking.openURL(sourceUrl)} hitSlop={8} style={styles.inlineTight}>
              <MaterialCommunityIcons name={fromArticle ? 'newspaper-variant-outline' : 'check-decagram-outline'} size={12 * s} color={K.muted} />
              <Text style={{ fontSize: 11.5 * s, color: K.muted, fontFamily: F.body }}>{fromArticle ? 'From the article' : step.source}</Text>
            </Pressable>
          )}
          {!!mitre && (
            <Pressable onPress={() => Linking.openURL(mitre)} hitSlop={8} style={styles.inlineTight}>
              <Text style={{ fontSize: 11.5 * s, color: K.muted, fontFamily: F.body }}>{step.technique || 'MITRE'}</Text>
              <MaterialCommunityIcons name="arrow-top-right" size={11 * s} color={K.muted} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// attacker profiles rarely change: fetch each one once per app session
const groupCache = new Map<string, ThreatGroup | null>();

function GroupCard({ id, s, K }: { id: string; s: number; K: Kit }) {
  const [g, setG] = useState<ThreatGroup | null>(groupCache.get(id) ?? null);
  useEffect(() => {
    if (groupCache.has(id)) return;
    let live = true;
    supabase
      .from('threat_groups')
      .select('*')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        const clean = cleanGroup((data as ThreatGroup | null) ?? null);
        groupCache.set(id, clean);
        if (live) setG(clean);
      });
    return () => {
      live = false;
    };
  }, [id]);
  if (!g) return null;
  const others = g.aliases.filter((a) => a !== g.name).slice(0, 4);
  return (
    <View style={[styles.panel, { backgroundColor: K.panel, borderColor: K.panelBorder, padding: 16 * s, marginTop: 18 * s }]}>
      <Text style={[styles.kicker, { color: K.muted, fontSize: 12.5 * s }]}>Who is behind it</Text>
      <Text style={{ fontSize: 22 * s, color: K.text, fontFamily: F.head, marginTop: 2 }}>{g.name}</Text>
      {others.length > 0 && <Text style={{ fontSize: 13 * s, color: K.muted, marginTop: 2, fontFamily: F.body }}>Also known as {others.join(', ')}</Text>}
      {!!g.summary && <Text style={{ fontSize: 15 * s, lineHeight: 22 * s, color: K.body, marginTop: 10 * s, fontFamily: F.body }}>{g.summary}</Text>}
      {g.methods.length > 0 && (
        <View style={[styles.chips, { marginTop: 12 * s }]}>
          {g.methods.slice(0, 5).map((m) => (
            <View key={m} style={[styles.chip, { backgroundColor: K.panel, borderColor: K.panelBorder }]}>
              <Text style={{ fontSize: 12.5 * s, color: K.body, fontFamily: F.body }}>{m}</Text>
            </View>
          ))}
        </View>
      )}
      {g.campaigns.length > 0 && (
        <Text style={{ fontSize: 13.5 * s, color: K.muted, marginTop: 12 * s, fontFamily: F.body }}>Past campaigns: {g.campaigns.slice(0, 3).join(', ')}</Text>
      )}
      {!!g.url && <Pressable onPress={() => Linking.openURL(g.url).catch(() => {})} style={{ marginTop: 10 * s }} hitSlop={8}>
        <Text style={{ fontSize: 12.5 * s, color: K.redSoft, fontFamily: F.label }}>MITRE ATT&CK® profile {g.id} ↗</Text>
      </Pressable>}
    </View>
  );
}

function Fact({ icon, label, value, s, K }: { icon: IconName; label: string; value: string; s: number; K: Kit }) {
  return (
    <View style={[styles.fact, { backgroundColor: K.panel, borderColor: K.panelBorder, padding: 12 * s }]}>
      <View style={styles.inlineTight}>
        <MaterialCommunityIcons name={icon} size={14 * s} color={K.red} />
        <Text style={[styles.kicker, { color: K.muted, fontSize: 12 * s }]}>{label}</Text>
      </View>
      <Text style={{ color: K.text, fontSize: 15 * s, lineHeight: 20 * s, marginTop: 4, fontFamily: F.head }} numberOfLines={3}>{value}</Text>
    </View>
  );
}

/** Drawn once, fully, with no animations: it is ready the moment the reader slides across. */
export const AttackChain = memo(function AttackChain({ story, scale: s, onBack, bg, look }: Props) {
  const themed = useTheme();
  // a card style (Newspaper, Magazine, Terminal) has its own paper, so the chain follows the paper, not the theme
  const C = look === 'light' ? LIGHT_PALETTE : look === 'dark' ? DARK_PALETTE : themed;
  const K = kit(C, bg);
  const steps = story.attack_chain ?? [];
  const inc = story.incident ?? {};
  const target = [inc.victim, inc.victim_country].filter(Boolean).join(', ');

  return (
    <View style={{ flex: 1, backgroundColor: K.bg }}>
      <Pressable onPress={onBack} style={styles.headerRow} hitSlop={10} accessibilityLabel="Back to story">
        <View style={[styles.back, { backgroundColor: K.panel, borderColor: K.panelBorder }]}>
          <MaterialCommunityIcons name="chevron-left" size={22 * s} color={K.text} />
        </View>
        <Text style={{ fontSize: 13 * s, color: K.muted, fontFamily: F.label, flex: 1 }}>Back to the story</Text>
        <View style={[styles.countPill, { backgroundColor: K.red }]}>
          <Text style={{ fontSize: 12 * s, color: '#FFFFFF', fontFamily: F.label }}>{steps.length} steps</Text>
        </View>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18 * s, paddingBottom: 28 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 25 * s, lineHeight: 30 * s, color: K.text, fontFamily: F.head, letterSpacing: -0.5 }}>How the attack worked</Text>
        <Text style={{ fontSize: 13.5 * s, lineHeight: 19 * s, color: K.muted, fontFamily: F.body, marginTop: 6 * s }}>{story.headline}</Text>

        {(!!target || !!inc.actor) && (
          <View style={[styles.inline, { marginTop: 14 * s, gap: 10 * s, alignItems: 'stretch' }]}>
            {!!target && <Fact icon="target" label="Target" value={target} s={s} K={K} />}
            {!!inc.actor && <Fact icon="skull-outline" label="Attacker" value={inc.actor} s={s} K={K} />}
          </View>
        )}
        {!!inc.actor_country && !!inc.attributed_by && (
          <Text style={{ color: K.muted, fontSize: 13 * s, marginTop: 8 * s, fontFamily: F.body }}>
            Linked to {inc.actor_country}, according to {inc.attributed_by}
          </Text>
        )}

        <Text style={[styles.kicker, { color: K.muted, fontSize: 12.5 * s, marginTop: 20 * s, marginBottom: 6 * s }]}>Attack path</Text>
        <AttackPath steps={steps} s={s} K={K} />

        <View style={[styles.divider, { backgroundColor: K.line, marginVertical: 18 * s }]} />

        {steps.map((step, i) => (
          <StepRow key={i} step={step} index={i} last={i === steps.length - 1} s={s} articleUrl={story.url} K={K} />
        ))}

        {inc.researched && (
          <Text style={{ fontSize: 12 * s, color: K.muted, marginTop: 10 * s, fontFamily: F.body }}>
            Steps from the article and trusted reports ({(inc.sources ?? []).join(', ')}).
          </Text>
        )}

        {!!story.actor_group && <GroupCard id={story.actor_group} s={s} K={K} />}

        <Text style={{ fontSize: 11.5 * s, color: K.muted, marginTop: 16 * s, lineHeight: 16 * s, fontFamily: F.body, opacity: 0.8 }}>
          Stages follow MITRE ATT&CK. Countries are only shown when officially stated.
        </Text>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  back: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  countPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginRight: 4 },
  kicker: { fontFamily: F.label },
  panel: { borderRadius: 18, borderWidth: 1 },
  fact: { flex: 1, borderRadius: 16, borderWidth: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inlineTight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  row: { flexDirection: 'row' },
  pathDot: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
});
