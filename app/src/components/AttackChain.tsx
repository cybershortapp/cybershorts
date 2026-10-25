import { memo, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { cleanGroup } from '../lib/clean';
import { supabase } from '../lib/supabase';
import type { Story, ThreatGroup } from '../lib/types';
import { DARK_PALETTE, F, LIGHT_PALETTE, type Palette, useTheme } from '../theme';
import { ChainPage } from './ChainPage';

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

/** The chain page: the premium explainer (Bento in dark themes, Editorial in light ones). */
export const AttackChain = memo(function AttackChain({ story, scale: s, onBack, bg, look }: Props) {
  const themed = useTheme();
  // a card style (Newspaper, Magazine, Terminal) has its own paper, so the chain follows the paper, not the theme
  const C = look === 'light' ? LIGHT_PALETTE : look === 'dark' ? DARK_PALETTE : themed;
  const dark = look ? look === 'dark' : C.dark || !!C.glass;
  void bg; // the explainer has its own paper in both looks
  return (
    <ChainPage
      story={story}
      s={s}
      dark={dark}
      onBack={onBack}
      renderGroup={story.actor_group ? () => <GroupCard id={story.actor_group!} s={s} K={dark ? kit(DARK_PALETTE) : kit(LIGHT_PALETTE)} /> : undefined}
    />
  );
});

const styles = StyleSheet.create({
  kicker: { fontFamily: F.label },
  panel: { borderRadius: 18, borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
});
