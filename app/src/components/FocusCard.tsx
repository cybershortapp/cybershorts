import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { actionFor } from '../lib/actions';
import { buzz } from '../lib/buzz';
import { highlight, type Piece } from '../lib/highlight';
import { useCardLayout } from '../lib/layout';
import { toggleTip, useTipDone } from '../lib/tips';
import type { Story } from '../lib/types';
import { F, type Palette, useTheme } from '../theme';
import { Cover } from './Cover';

/**
 * Focus: the default story card (release 1.0.6), designed around how people actually read.
 * 1. Picture first: a big, clear picture of what happened.
 * 2. One loud thing: only the headline is big and bold.
 * 3. Key facts highlighted: numbers, danger words and products get a soft marker. The words never change.
 * 4. The tip stands out: the only coloured box on the card, with a tick to feel "done".
 * 5. Every button sits where the thumb already rests.
 */
type Props = {
  story: Story;
  width: number;
  height: number;
  active: boolean;
  saved: boolean;
  showImage: boolean;
  showSeverity: boolean;
  meta: string; // "Source · 44 min ago" (or the date of a history card)
  caughtUp?: boolean;
  onImageError: () => void;
  onOpen: () => void;
  onSave: () => void;
  onShare: () => void;
  onReport: () => void;
  onReadMore: () => void;
  onChain?: () => void;
  chainBlink?: Animated.Value; // 0..1, the CHAIN tab blinks to hint at the attack chain
  scale: number; // tablets draw a little bigger
};

export const SEV_DOT: Record<string, string> = { Critical: '#E5243B', High: '#F07A12', Medium: '#D9A400', Info: '#7C8394' };
const PILL: Record<string, string> = {
  Breaches: 'Data breach',
  Vulnerabilities: 'Vulnerability',
  Scams: 'Scam',
  Tips: 'Cyber tip',
  History: 'Cyber history',
  Other: 'Cyber news',
};

/** Colours that work on every theme: the paper look on Light, softer versions on Dark and the glass themes. */
function look(C: Palette) {
  if (C.glass) {
    return {
      ink: '#FFFFFF', body: 'rgba(255,255,255,0.86)', muted: 'rgba(255,255,255,0.62)',
      mark: 'rgba(255,214,77,0.38)', markInk: '#FFFFFF',
      tipBg: 'rgba(255,255,255,0.14)', tipBorder: 'rgba(255,255,255,0.22)', tipLabel: '#FFE38A', tipInk: '#FFFFFF',
      pill: '#FFFFFF', pillInk: '#000000', link: '#FFFFFF',
      tickBg: 'rgba(255,255,255,0.16)', tickInk: '#FFFFFF', tickBorder: 'rgba(255,255,255,0.35)',
    };
  }
  if (C.dark) {
    return {
      ink: '#F3F4F8', body: '#C3C8D4', muted: '#8B93A7',
      mark: 'rgba(255,200,60,0.30)', markInk: '#FFFFFF',
      tipBg: '#2B2615', tipBorder: '#463C17', tipLabel: '#E8C25A', tipInk: '#F6EBC8',
      pill: '#FFFFFF', pillInk: '#0A0E17', link: '#8FB0FF',
      tickBg: 'rgba(255,255,255,0.08)', tickInk: '#E8C25A', tickBorder: 'rgba(232,194,90,0.45)',
    };
  }
  return {
    ink: '#14161F', body: '#4A4D5A', muted: '#8A8D98',
    mark: 'rgba(255,214,77,0.55)', markInk: '#14161F',
    tipBg: '#FFF3C9', tipBorder: '#FFE9A3', tipLabel: '#8A6400', tipInk: '#2E2400',
    pill: '#14161F', pillInk: '#FFFFFF', link: '#3A4BE0',
    tickBg: 'rgba(255,255,255,0.75)', tickInk: '#5A4300', tickBorder: 'rgba(90,67,0,0.25)',
  };
}

/** The tip starts with something to do. */
const TO_DO = /^(?:do not|don't|never|always|avoid|check|update|install|apply|patch|review|monitor|audit|enable|disable|turn|change|reset|use|set|block|remove|delete|uninstall|scan|verify|confirm|watch|keep|be|beware|stay|limit|restrict|rotate|revoke|back ?up|report|treat|secure|detect|look|ignore|contact|call|freeze|consider|ensure|make|protect|restart|upgrade|switch|stop|hide|lock|add|replace|follow|read|think|hang up|warn|tell|ask|search|test|plan|prepare|segment|isolate|harden|track|log)\b/i;

type Bit = { text: string; kind: 'plain' | 'mark' | 'cve' };
const MONTH = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s$/;
const CURRENCY = /[$£€₹]$/;
const STOP = new Set(['and', 'or', 'to', 'in', 'of', 'by', 'for', 'the', 'a', 'an', 'on', 'at', 'from', 'with', 'that', 'which', 'was', 'were', 'is', 'are', 'has', 'have', 'after', 'before', 'as', 'than', 'into']);
// numbers tell the story fastest ("31 malicious", "$220 million"), then danger words, then product names
const PRIORITY: Record<string, number> = { number: 0, danger: 1, product: 2 };
const MAX_MARKS = 4;
const MAX_PRODUCTS = 2;

/**
 * The summary split into plain words, marked key facts and CVE numbers. Only the look changes: the text is
 * exactly the AI summary. Numbers take the words that belong to them ("117,574 customer accounts",
 * "October 19", "$175,000"), and at most four facts are marked so the marker still means something.
 */
export function focusBits(text: string, story: Pick<Story, 'products'>): Bit[] {
  const pieces: (Piece & { keep?: boolean })[] = highlight(text, story).map((p) => ({ ...p }));
  // a number takes its currency sign, its month, and up to three following words
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.mark !== 'number') continue;
    const before = pieces[i - 1];
    if (before && !before.mark) {
      const m = MONTH.exec(before.text) ?? CURRENCY.exec(before.text);
      if (m) {
        before.text = before.text.slice(0, before.text.length - m[0].length);
        p.text = m[0] + p.text;
      }
    }
    const after = pieces[i + 1];
    if (after && !after.mark && /^\s/.test(after.text) && !/[a-z]\s?$/i.test(p.text.replace(/\d/g, ''))) {
      const re = /^(\s+)([A-Za-z][\w-]*)([,.;:!?)]?)/;
      let rest = after.text;
      let took = '';
      for (let n = 0; n < 3; n++) {
        const w = re.exec(rest);
        if (!w || STOP.has(w[2].toLowerCase())) break;
        took += w[1] + w[2];
        rest = rest.slice(w[1].length + w[2].length);
        if (w[3]) break; // the phrase ends at a comma or full stop
      }
      if (took) {
        p.text += took;
        after.text = rest;
      }
    }
    // a bare small number on its own ("72", "11") says nothing without its words: leave it plain
    if (/^\d{1,3}$/.test(p.text)) p.mark = null;
  }
  // keep the most telling marks: danger words first, then products, then numbers; each fact once
  const seen = new Set<string>();
  let products = 0;
  pieces
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.mark && p.mark !== 'cve')
    .sort((a, b) => PRIORITY[a.p.mark!] - PRIORITY[b.p.mark!] || a.i - b.i)
    .forEach(({ p }) => {
      const key = p.text.toLowerCase();
      if (seen.size >= MAX_MARKS || seen.has(key)) return;
      if (p.mark === 'product' && products >= MAX_PRODUCTS) return;
      if (p.mark === 'product') products++;
      seen.add(key);
      p.keep = true;
    });
  const out: Bit[] = [];
  for (const p of pieces) {
    if (!p.text) continue;
    const kind: Bit['kind'] = p.mark === 'cve' ? 'cve' : p.keep ? 'mark' : 'plain';
    const last = out[out.length - 1];
    if (last && last.kind === 'plain' && kind === 'plain') last.text += p.text;
    else out.push({ text: p.text, kind });
  }
  return out;
}

function Summary({ bits, style, mark, mono, lines }: { bits: Bit[]; style: TextStyle; mark: TextStyle; mono: TextStyle; lines?: number }) {
  return (
    <Text style={style} numberOfLines={lines}>
      {bits.map((b, i) =>
        b.kind === 'mark' ? (
          <Text key={i} style={mark}>{b.text}</Text>
        ) : b.kind === 'cve' ? (
          <Text key={i} style={mono}>{b.text}</Text>
        ) : (
          b.text
        ),
      )}
    </Text>
  );
}

export function FocusFace(p: Props) {
  const { story, width, height, active, scale } = p;
  const C = useTheme();
  const K = useMemo(() => look(C), [C]);
  const L = useCardLayout(height + 16);
  // the picture gets the biggest share it can while leaving room for a few lines of summary
  const share = L.isTablet ? 0.44 : height < 520 ? 0.32 : height < 600 ? 0.36 : 0.41;
  const imgH = Math.round(Math.min(width * 0.82, Math.max(140, height * share)));
  const short = height < 600;
  const headSize = Math.round(L.headlineSize * 1.18);
  const headLine = Math.round(headSize * 1.2);
  const bodySize = L.bodySize - 0.5;
  const bodyLine = L.bodyLine;
  const bits = useMemo(() => focusBits(story.technical, story), [story]);
  const action = actionFor(story);
  const tip = story.why_it_matters?.trim() || '';
  // most of these are something to do ("Update...", "Check..."): a tip with a tick. The rest explain why it matters.
  const doable = TO_DO.test(tip);
  const tipDone = useTipDone(story.id);
  const pill = story.zero_day ? 'Zero-day' : PILL[story.category] ?? story.category;
  const aiImage = !!story.image_url && story.image_url.includes('/object/public/covers/');

  // the summary gets whatever room is left; "Read more" shows when it doesn't all fit
  const [boxH, setBoxH] = useState(0);
  const [fullH, setFullH] = useState(0);
  const [lineH, setLineH] = useState(0);
  const [linksH, setLinksH] = useState(0);
  const realLine = lineH || bodyLine;
  // room for the summary: the box, minus the "Read more" row under it
  const lines = boxH ? Math.max(0, Math.floor((boxH - linksH + 1) / realLine)) : 3;
  const cut = fullH > lines * realLine + 2;

  // the picture drifts very slowly while the card is on screen (it feels alive, never distracting)
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 7000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 7000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    a.start();
    return () => a.stop();
  }, [active, drift]);

  // ticking the tip: a little pop
  const pop = useRef(new Animated.Value(1)).current;
  const tick = () => {
    if (!tipDone) buzz.right();
    else buzz.tick();
    toggleTip(story.id);
    pop.setValue(0.8);
    Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  };

  const markStyle: TextStyle = { backgroundColor: K.mark, color: K.markInk, fontFamily: F.head };
  const monoStyle: TextStyle = { fontFamily: 'JetBrainsMono_400Regular', fontSize: bodySize - 1.5, color: K.ink };
  const bodyStyle: TextStyle = { color: K.body, fontSize: bodySize, lineHeight: bodyLine, fontFamily: F.body };
  const icon = Math.round(21 * Math.min(scale, 1.3));

  return (
    <View style={{ width, flex: 1 }}>
      {/* 1. the picture */}
      <View style={[styles.imageWrap, { height: imgH, marginTop: 4, marginHorizontal: 2 }]}>
        <Pressable onPress={p.onOpen} style={[styles.image, { backgroundColor: C.imageBg }]} accessibilityLabel="Open article">
          {p.showImage ? (
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                {
                  transform: [
                    { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1.03, 1.08] }) },
                    { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
                  ],
                },
              ]}
            >
              <Image
                source={{ uri: story.image_url! }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                priority={active ? 'high' : 'normal'}
                recyclingKey={story.id}
                cachePolicy="memory-disk"
                onError={p.onImageError}
                accessibilityIgnoresInvertColors
              />
            </Animated.View>
          ) : (
            <Cover story={story} height={imgH} width={width - 4} iconSize={L.iconSize} />
          )}
          <View style={styles.pill}>
            {story.zero_day && <MaterialCommunityIcons name="lightning-bolt" size={12} color="#C2410C" />}
            <Text style={styles.pillText}>{pill}</Text>
          </View>
          {p.showImage && (
            <Text style={styles.credit} numberOfLines={1}>
              {aiImage ? 'AI illustration' : `Image: ${story.source}`}
            </Text>
          )}
        </Pressable>
      </View>

      {/* 2. what it is, and the one loud thing: the headline */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
        {p.caughtUp && (
          <View style={[styles.caught, { backgroundColor: C.dark || C.glass ? 'rgba(255,255,255,0.08)' : '#ECEAE4' }]}>
            <MaterialCommunityIcons name="check-circle" size={15} color={C.glass ? '#FFFFFF' : C.brand} />
            <Text style={{ color: K.ink, fontSize: 12.5, fontFamily: F.label }}>You're all caught up. Earlier stories below.</Text>
          </View>
        )}
        <View style={[styles.meta, { paddingRight: p.onChain ? 52 * scale : 0 }]}>
          {p.showSeverity && !!story.severity && (
            <>
              <View style={[styles.dot, { backgroundColor: SEV_DOT[story.severity] ?? SEV_DOT.Info }]} />
              <Text style={{ color: K.ink, fontFamily: F.head, fontSize: L.metaSize }}>{story.severity}</Text>
              <Text style={{ color: K.muted, fontSize: L.metaSize }}>·</Text>
            </>
          )}
          <Text style={{ flexShrink: 1, color: K.muted, fontFamily: F.medium, fontSize: L.metaSize }} numberOfLines={1}>
            {p.meta}
          </Text>
        </View>
        <Pressable onPress={p.onOpen}>
          <Text
            numberOfLines={3}
            style={{ color: K.ink, fontFamily: F.brand, fontSize: headSize, lineHeight: headLine, letterSpacing: -0.5, marginTop: 6 }}
          >
            {story.headline}
          </Text>
        </Pressable>

        {/* 3. the summary, key facts marked; it ends with "..." when there's no more room */}
        <View style={{ flex: 1, overflow: 'hidden', marginTop: 8 }} onLayout={(e) => setBoxH(e.nativeEvent.layout.height)}>
          {/* invisible copies, only measured: the full summary, and one line at this phone's text size */}
          <View style={styles.measure} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
            <View onLayout={(e) => setFullH(e.nativeEvent.layout.height)}>
              <Summary bits={bits} style={bodyStyle} mark={markStyle} mono={monoStyle} />
            </View>
          </View>
          <Text
            style={[bodyStyle, styles.measure]}
            numberOfLines={1}
            onLayout={(e) => setLineH(e.nativeEvent.layout.height)}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            A
          </Text>
          {lines > 0 && (
            <Pressable onPress={cut ? p.onReadMore : undefined} disabled={!cut} accessibilityLabel={cut ? 'Read the full summary' : undefined}>
              <Summary bits={bits} style={bodyStyle} mark={markStyle} mono={monoStyle} lines={lines} />
            </Pressable>
          )}
          {(cut || action) && (
          <View style={styles.links} onLayout={(e) => setLinksH(e.nativeEvent.layout.height + 4)}>
            {cut && (
              <Pressable onPress={p.onReadMore} hitSlop={8} accessibilityRole="button">
                <Text style={[styles.more, { color: K.ink, fontSize: L.metaSize + 1 }]}>Read more</Text>
              </Pressable>
            )}
            {action && (
              <Pressable onPress={() => Linking.openURL(action.url)} hitSlop={8} style={styles.action} accessibilityRole="link">
                <Text style={{ color: K.link, fontFamily: F.head, fontSize: L.metaSize + 0.5 }} numberOfLines={1}>
                  {action.label}
                </Text>
                <MaterialCommunityIcons name="arrow-top-right" size={14} color={K.link} />
              </Pressable>
            )}
          </View>
          )}
        </View>
      </View>

      {/* 4. the tip: the only coloured box, with a tick */}
      {!!tip && (
        <View style={[styles.tip, { backgroundColor: tipDone && doable ? (C.dark || C.glass ? 'rgba(52,199,89,0.18)' : '#DDF5E4') : K.tipBg, borderColor: tipDone && doable ? 'rgba(22,163,74,0.35)' : K.tipBorder }]}>
          <View style={[styles.bulb, { backgroundColor: tipDone && doable ? '#22C55E' : '#FFD84D' }]}>
            <MaterialCommunityIcons name={!doable ? 'information-variant' : tipDone ? 'check-bold' : 'lightbulb-on-outline'} size={15} color={tipDone && doable ? '#FFFFFF' : '#5A4300'} />
          </View>
          {/* the label sits in the same line as the tip, so the box takes less room from the story */}
          <Text style={{ flex: 1, color: K.tipInk, fontFamily: F.label, fontSize: 13.5 * Math.min(scale, 1.2), lineHeight: 18.5 * Math.min(scale, 1.2) }} numberOfLines={short ? 2 : 3}>
            <Text style={{ fontFamily: F.brand, color: tipDone && doable ? (C.dark || C.glass ? '#86EFAC' : '#15803D') : K.tipLabel }}>
              {!doable ? 'Why it matters: ' : tipDone ? 'Done: ' : 'Tip: '}
            </Text>
            {tip}
          </Text>
          {doable && (
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Pressable
              onPress={tick}
              hitSlop={10}
              style={[styles.tick, { backgroundColor: K.tickBg, borderColor: K.tickBorder }, tipDone && { backgroundColor: '#22C55E', borderColor: '#22C55E' }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: tipDone }}
              accessibilityLabel={tipDone ? 'Tip done. Tap to undo' : 'Mark the tip as done'}
            >
              <MaterialCommunityIcons name="check" size={16} color={tipDone ? '#FFFFFF' : K.tickInk} />
            </Pressable>
          </Animated.View>
          )}
        </View>
      )}

      {/* 5. the thumb zone: save, share, report and the main button */}
      <View style={styles.bar}>
        <View style={{ flexDirection: 'row' }}>
          <Pressable onPress={p.onSave} style={styles.iconBtn} accessibilityLabel={p.saved ? 'Remove from saved' : 'Save story'}>
            <MaterialCommunityIcons name={p.saved ? 'bookmark' : 'bookmark-outline'} size={icon} color={p.saved ? C.brand : K.ink} />
          </Pressable>
          <Pressable onPress={p.onShare} style={styles.iconBtn} accessibilityLabel="Share story">
            <MaterialCommunityIcons name="export-variant" size={icon} color={K.ink} />
          </Pressable>
          <Pressable onPress={p.onReport} style={styles.iconBtn} accessibilityLabel="Report an error">
            <MaterialCommunityIcons name="flag-outline" size={icon} color={K.ink} />
          </Pressable>
        </View>
        <Pressable onPress={p.onOpen} style={[styles.read, { backgroundColor: K.pill }]} accessibilityRole="link" accessibilityLabel={`Read full story on ${story.source}`}>
          <Text style={{ color: K.pillInk, fontFamily: F.head, fontSize: 14.5 * Math.min(scale, 1.2) }}>
            {story.category === 'History' ? 'Read the story' : 'Read full story'}
          </Text>
          <MaterialCommunityIcons name="arrow-right" size={16} color={K.pillInk} />
        </Pressable>
      </View>

      {/* the CHAIN tab: the same blue tab at the right edge, at the foot of the picture */}
      {!!p.onChain && (
        <Animated.View
          style={{
            position: 'absolute',
            right: 0,
            top: 4 + imgH - 34 * scale,
            opacity: p.chainBlink ? p.chainBlink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }) : 1,
          }}
        >
          <Pressable onPress={p.onChain} style={[styles.tab, { backgroundColor: C.glass ? '#2563F5' : C.brand, width: 46 * scale, paddingVertical: 8 * scale }]} accessibilityLabel="Show attack chain">
            <MaterialCommunityIcons name="link-variant" size={18 * scale} color="#FFFFFF" />
            <Text style={[styles.tabText, { fontSize: 9.5 * scale }]}>CHAIN</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  imageWrap: {
    borderRadius: 24,
    shadowColor: '#14161F',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  image: { flex: 1, borderRadius: 24, overflow: 'hidden' },
  pill: {
    position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.94)',
  },
  pillText: { color: '#14161F', fontFamily: F.head, fontSize: 12 },
  credit: {
    position: 'absolute', left: 14, bottom: 8, maxWidth: '70%', color: 'rgba(255,255,255,0.6)', fontSize: 9.5, fontFamily: F.medium,
    textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 3,
  },
  caught: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
  links: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginTop: 4 },
  more: { fontFamily: F.head, textDecorationLine: 'underline' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  // compact: small icon and tick, the label in the text line, so the story above gets more lines
  tip: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 4, marginTop: 8,
    paddingVertical: 8, paddingLeft: 9, paddingRight: 8, borderRadius: 16, borderWidth: 1,
  },
  bulb: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tick: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(90,67,0,0.25)',
    backgroundColor: 'rgba(255,255,255,0.75)', alignItems: 'center', justifyContent: 'center',
  },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 2, paddingRight: 6, paddingTop: 8, paddingBottom: 6 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  read: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 20, borderRadius: 23 },
  tab: { alignItems: 'center', gap: 2, borderTopLeftRadius: 14, borderBottomLeftRadius: 14, shadowColor: '#14289F', shadowOpacity: 0.25, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  tabText: { color: '#FFFFFF', fontFamily: F.brand, letterSpacing: 0.8, marginTop: 1 },
});
