import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { memo, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { chainLink } from '../lib/actions';
import { cleanGroup } from '../lib/clean';
import { supabase } from '../lib/supabase';
import type { ChainStep, Story, ThreatGroup } from '../lib/types';
import { F } from '../theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;
type Props = { story: Story; scale: number; width: number; onBack: () => void };

/** Red and charcoal incident board. Built from plain views only (no measuring, no SVG) so it opens instantly. */
const K = {
  bg: '#221C1D',
  panel: '#2C2526',
  line: '#3E3435',
  red: '#E53935',
  redSoft: '#FF8A80',
  text: '#F6F1F1',
  body: '#DDD5D5',
  muted: '#A89B9B',
  rust: '#9C4F22',
  rustDark: '#5E2A0E',
};
const LABEL = 'Oswald_500Medium';
const HEAD = 'Oswald_700Bold';

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

/** A short rusty chain between two steps: simple rounded links, clipped to whatever height the row has. */
const ChainLinks = memo(function ChainLinks({ s }: { s: number }) {
  const links: React.ReactNode[] = [];
  for (let i = 0; i < 10; i++) {
    links.push(
      i % 2 === 0 ? (
        <View key={i} style={{ width: 11 * s, height: 17 * s, borderRadius: 6 * s, borderWidth: 2.5 * s, borderColor: K.rust, marginVertical: -2 * s }} />
      ) : (
        <View key={i} style={{ width: 3.5 * s, height: 13 * s, borderRadius: 2 * s, backgroundColor: K.rustDark, marginVertical: -2 * s }} />
      ),
    );
  }
  // absolutely placed, so the chain fills the gap but never makes the row taller
  return <View style={[styles.links, { top: 44 * s }]} pointerEvents="none">{links}</View>;
});

/** The whole attack at a glance: one icon per step, joined left to right. */
function AttackPath({ steps, s }: { steps: ChainStep[]; s: number }) {
  const size = (steps.length > 7 ? 26 : 32) * s;
  const out: React.ReactNode[] = [];
  steps.forEach((st, i) => {
    const hot = HOT.has(st.stage);
    if (i > 0) out.push(<View key={`l${i}`} style={{ flex: 1, minWidth: 4, height: 2.5, backgroundColor: K.rust }} />);
    out.push(
      <View key={i} style={[styles.pathDot, { width: size, height: size, borderRadius: size / 2, backgroundColor: hot ? K.red : K.panel, borderColor: K.red }]}>
        <MaterialCommunityIcons name={iconFor(st.stage)} size={size * 0.5} color={hot ? K.bg : K.redSoft} />
      </View>,
    );
  });
  // spread across the full width, so the whole attack fits on one line
  return <View style={[styles.row, { alignItems: 'center', paddingVertical: 4 }]}>{out}</View>;
}

function StepRow({ step, index, last, s, articleUrl }: {
  step: ChainStep; index: number; last: boolean; s: number; articleUrl: string;
}) {
  const hot = HOT.has(step.stage);
  const mitre = chainLink(step);
  const fromArticle = !step.source || step.source === 'article';
  const sourceUrl = fromArticle ? articleUrl : step.source_url;
  const node = 40 * s;

  return (
    <View style={styles.row}>
      {/* left rail: numbered node, then the chain down to the next step */}
      <View style={{ width: 52 * s, alignItems: 'center' }}>
        <View style={[styles.node, { width: node, height: node, borderRadius: node / 2, backgroundColor: hot ? K.red : K.bg }]}>
          <Text style={{ color: hot ? K.bg : K.red, fontSize: 18 * s, fontFamily: HEAD }}>{index + 1}</Text>
        </View>
        {!last && <ChainLinks s={s} />}
      </View>

      <View style={{ flex: 1, paddingLeft: 6 * s, paddingBottom: last ? 4 : 22 * s, paddingTop: 2 * s }}>
        <View style={styles.inline}>
          <MaterialCommunityIcons name={iconFor(step.stage)} size={18 * s} color={K.redSoft} />
          <Text style={{ color: K.text, fontSize: 17 * s, fontFamily: LABEL, letterSpacing: 0.8, flexShrink: 1 }}>{step.stage.toUpperCase()}</Text>
        </View>
        <Text style={{ color: K.body, fontSize: 16 * s, lineHeight: 23 * s, marginTop: 5 * s }}>{step.detail}</Text>
        <View style={[styles.inline, { marginTop: 7 * s, gap: 14 * s }]}>
          {!!sourceUrl && (
            <Pressable onPress={() => Linking.openURL(sourceUrl)} hitSlop={8} style={styles.inlineTight}>
              <MaterialCommunityIcons name={fromArticle ? 'newspaper-variant-outline' : 'check-decagram-outline'} size={13 * s} color={K.muted} />
              <Text style={{ fontSize: 12.5 * s, color: K.muted }}>{fromArticle ? 'From the article' : step.source}</Text>
            </Pressable>
          )}
          {!!mitre && (
            <Pressable onPress={() => Linking.openURL(mitre)} hitSlop={8} style={styles.inlineTight}>
              <Text style={{ fontSize: 12.5 * s, color: K.muted }}>{step.technique || 'MITRE'}</Text>
              <MaterialCommunityIcons name="arrow-top-right" size={12 * s} color={K.muted} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// attacker profiles rarely change: fetch each one once per app session
const groupCache = new Map<string, ThreatGroup | null>();

function GroupCard({ id, s }: { id: string; s: number }) {
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
    <View style={[styles.panel, { padding: 16 * s, marginTop: 18 * s }]}>
      <Text style={[styles.kicker, { fontSize: 12 * s }]}>WHO IS BEHIND IT</Text>
      <Text style={{ fontSize: 22 * s, color: K.text, fontFamily: F.brand, marginTop: 2 }}>{g.name}</Text>
      {others.length > 0 && <Text style={{ fontSize: 13 * s, color: K.muted, marginTop: 2 }}>Also known as {others.join(', ')}</Text>}
      {!!g.summary && <Text style={{ fontSize: 15 * s, lineHeight: 22 * s, color: K.body, marginTop: 10 * s }}>{g.summary}</Text>}
      {g.methods.length > 0 && (
        <View style={[styles.chips, { marginTop: 12 * s }]}>
          {g.methods.slice(0, 5).map((m) => (
            <View key={m} style={styles.chip}>
              <Text style={{ fontSize: 12.5 * s, color: K.body }}>{m}</Text>
            </View>
          ))}
        </View>
      )}
      {g.campaigns.length > 0 && (
        <Text style={{ fontSize: 13.5 * s, color: K.muted, marginTop: 12 * s }}>Past campaigns: {g.campaigns.slice(0, 3).join(', ')}</Text>
      )}
      {!!g.url && <Pressable onPress={() => Linking.openURL(g.url).catch(() => {})} style={{ marginTop: 10 * s }} hitSlop={8}>
        <Text style={{ fontSize: 12.5 * s, color: K.redSoft }}>MITRE ATT&CK® profile {g.id} ↗</Text>
      </Pressable>}
    </View>
  );
}

function Fact({ icon, label, value, s }: { icon: IconName; label: string; value: string; s: number }) {
  return (
    <View style={[styles.fact, { padding: 12 * s }]}>
      <View style={styles.inlineTight}>
        <MaterialCommunityIcons name={icon} size={14 * s} color={K.red} />
        <Text style={[styles.kicker, { fontSize: 11.5 * s }]}>{label}</Text>
      </View>
      <Text style={{ color: K.text, fontSize: 15 * s, lineHeight: 20 * s, marginTop: 4, fontFamily: F.head }} numberOfLines={3}>{value}</Text>
    </View>
  );
}

/** Drawn once, fully, with no animations: it is ready the moment the reader slides across. */
export const AttackChain = memo(function AttackChain({ story, scale: s, onBack }: Props) {
  const steps = story.attack_chain ?? [];
  const inc = story.incident ?? {};
  const target = [inc.victim, inc.victim_country].filter(Boolean).join(', ');

  return (
    <View style={{ flex: 1, backgroundColor: K.bg }}>
      <Pressable onPress={onBack} style={styles.headerRow} hitSlop={10} accessibilityLabel="Back to story">
        <MaterialCommunityIcons name="chevron-left" size={26 * s} color={K.text} />
        <Text style={{ fontSize: 15 * s, color: K.text, fontFamily: HEAD, letterSpacing: 2, flex: 1 }}>ATTACK CHAIN</Text>
        <View style={styles.countPill}>
          <Text style={{ fontSize: 12 * s, color: K.bg, fontFamily: HEAD, letterSpacing: 1 }}>{steps.length} STEPS</Text>
        </View>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18 * s, paddingBottom: 28 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        <Text style={{ fontSize: 21 * s, lineHeight: 28 * s, color: K.text, fontFamily: F.head }}>{story.headline}</Text>

        {(!!target || !!inc.actor) && (
          <View style={[styles.inline, { marginTop: 14 * s, gap: 10 * s, alignItems: 'stretch' }]}>
            {!!target && <Fact icon="target" label="TARGET" value={target} s={s} />}
            {!!inc.actor && <Fact icon="skull-outline" label="ATTACKER" value={inc.actor} s={s} />}
          </View>
        )}
        {!!inc.actor_country && !!inc.attributed_by && (
          <Text style={{ color: K.muted, fontSize: 13 * s, marginTop: 8 * s }}>
            Linked to {inc.actor_country}, according to {inc.attributed_by}
          </Text>
        )}

        <Text style={[styles.kicker, { fontSize: 12 * s, marginTop: 20 * s, marginBottom: 6 * s }]}>ATTACK PATH</Text>
        <AttackPath steps={steps} s={s} />

        <View style={[styles.divider, { marginVertical: 18 * s }]} />

        {steps.map((step, i) => (
          <StepRow key={i} step={step} index={i} last={i === steps.length - 1} s={s} articleUrl={story.url} />
        ))}

        {inc.researched && (
          <Text style={{ fontSize: 12.5 * s, color: K.muted, marginTop: 10 * s }}>
            Steps from the article and trusted reports ({(inc.sources ?? []).join(', ')}).
          </Text>
        )}

        {!!story.actor_group && <GroupCard id={story.actor_group} s={s} />}

        <Text style={{ fontSize: 12 * s, color: K.muted, marginTop: 16 * s, lineHeight: 17 * s }}>
          Stages follow MITRE ATT&CK. Countries are only shown when officially stated.
        </Text>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingTop: 14, paddingBottom: 10 },
  countPill: { backgroundColor: K.red, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginRight: 6 },
  kicker: { color: K.muted, fontFamily: LABEL, letterSpacing: 1.6 },
  panel: { backgroundColor: K.panel, borderRadius: 16 },
  fact: { flex: 1, backgroundColor: K.panel, borderRadius: 14 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineTight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  row: { flexDirection: 'row' },
  node: { borderWidth: 2.5, borderColor: K.red, alignItems: 'center', justifyContent: 'center' },
  links: { position: 'absolute', bottom: 2, left: 0, right: 0, alignItems: 'center', overflow: 'hidden' },
  pathDot: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: K.line },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: '#3A3031', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
});
