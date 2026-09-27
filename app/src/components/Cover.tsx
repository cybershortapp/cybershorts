import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import type { Story } from '../lib/types';
import { C, F } from '../theme';

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

// a few icons per category, so cards next to each other don't look identical
const ICONS: Record<string, IconName[]> = {
  Breaches: ['database-lock-outline', 'account-lock-outline', 'file-lock-outline', 'server-security'],
  Scams: ['hook', 'message-alert-outline', 'email-alert-outline', 'cellphone-message'],
  Vulnerabilities: ['bug-outline', 'shield-alert-outline', 'lock-open-alert-outline', 'code-braces'],
  Ransomware: ['lock-outline', 'file-lock-outline', 'safe-square-outline', 'lock-alert-outline'],
  Tools: ['tools', 'console', 'wrench-outline', 'cog-outline'],
  Policy: ['scale-balance', 'gavel', 'file-document-outline', 'bank-outline'],
  Other: ['shield-outline', 'earth', 'radar', 'shield-check-outline'],
};

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Our own card artwork: no photo licensing needed. */
export function Cover({ story, height, width, iconSize }: { story: Story; height: number; width: number; iconSize: number }) {
  const h = hash(story.id);
  const set = ICONS[story.category] ?? ICONS.Other;
  const main = set[h % set.length];
  const critical = story.severity === 'Critical';

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]}>
      {/* one picture for the background pattern (much lighter than drawing hundreds of small icons) */}
      <Image source={require('../../assets/cover-pattern.jpg')} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View
        style={[
          styles.badge,
          { width: iconSize * 1.7, height: iconSize * 1.7, borderRadius: iconSize, borderColor: critical ? '#C62F2E' : C.borderSoft },
        ]}
      >
        <MaterialCommunityIcons name={main} size={iconSize * 0.9} color={critical ? '#C62F2E' : C.brandDark} />
      </View>
      <Text style={[styles.label, { color: C.brandText }]}>{story.category.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: C.imageBg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { backgroundColor: C.white, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: 8, fontSize: 11, fontFamily: F.label, letterSpacing: 1.5, backgroundColor: C.imageBg, paddingHorizontal: 8, borderRadius: 4, overflow: 'hidden' },
});
