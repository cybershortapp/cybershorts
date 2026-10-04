import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { actionFor } from '../lib/actions';
import { SHOW_SOURCE_IMAGES } from '../lib/config';
import { sendReport } from '../lib/report';
import { REPORT_REASONS, type ReportReason } from '../lib/types';
import { useCardLayout } from '../lib/layout';
import { timeAgo } from '../lib/time';
import type { Story } from '../lib/types';
import { F, type Palette, severityOf, tabColour, useTheme } from '../theme';
import { AttackChain } from './AttackChain';
import { Cover } from './Cover';
import { Sheet, SheetRow } from './Sheet';

// shared across all cards: the slide hint plays once per app session
let peekShownThisSession = false;

type Props = {
  story: Story;
  height: number;
  active: boolean;
  saved: boolean;
  onToggleSave: (id: string) => void;
  isNew?: boolean; // added since the reader last opened the app
  caughtUp?: boolean; // first story they have already seen
};

function StoryCardBase({ story, height, active, saved, onToggleSave, isNew, caughtUp }: Props) {
  const C = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const L = useCardLayout(height);
  const sev = severityOf(story.severity, C);
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = SHOW_SOURCE_IMAGES && !!story.image_url && !imageFailed;
  const [sheet, setSheet] = useState<null | 'report' | 'summary'>(null);
  // measured full height of the summary, to know when it doesn't fit and needs "Read more"
  const [fullLines, setFullLines] = useState(0);

  // the chain page is only built when the reader opens it (tap CHAIN or swipe), so scrolling stays fast
  const [chainReady, setChainReady] = useState(false);
  const [bodyLines, setBodyLines] = useState(6);
  const truncated = fullLines > bodyLines;
  const historyCard = story.category === 'History';
  // tips and history are always "Info", so that label tells the reader nothing there
  const showSeverity = !!story.severity && !((story.category === 'Tips' || historyCard) && story.severity === 'Info');
  const aiImage = !!story.image_url && story.image_url.includes('/object/public/covers/');
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const action = actionFor(story);
  const hasChain = (story.attack_chain?.length ?? 0) >= 3;
  const pager = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(0)).current;
  const nudge = useRef(new Animated.Value(0)).current;
  const scale = L.isTablet ? 1.35 : 1;

  // Hint that a chain is there, without words:
  // the first chain card in a session gently slides towards the chain and back (once),
  // every chain card after that just blinks the CHAIN tab.
  useEffect(() => {
    if (!hasChain || !active) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    let anim: Animated.CompositeAnimation | null = null;
    if (!peekShownThisSession) {
      peekShownThisSession = true;
      const peek = Math.round(L.cardWidth * 0.2);
      anim = Animated.sequence([
        Animated.delay(700),
        Animated.timing(nudge, { toValue: -peek, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(280),
        Animated.spring(nudge, { toValue: 0, friction: 6, tension: 60, useNativeDriver: true }),
      ]);
      anim.start();
    } else {
      anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: 280, useNativeDriver: true }),
        ]),
        { iterations: 3 },
      );
      timers.push(setTimeout(() => anim?.start(), 400));
    }
    return () => {
      timers.forEach(clearTimeout);
      anim?.stop();
      pulse.setValue(0);
      nudge.setValue(0);
    };
  }, [active, hasChain, pulse, L.cardWidth]);

  // build the chain page quietly while the reader is on this card (after scrolling has finished),
  // so tapping CHAIN opens instantly instead of building it on the tap
  useEffect(() => {
    if (!hasChain || !active || chainReady) return;
    const g = globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idle: number | undefined;
    const t = setTimeout(() => {
      if (g.requestIdleCallback) idle = g.requestIdleCallback(() => setChainReady(true), { timeout: 2000 });
      else setChainReady(true);
    }, 900);
    return () => {
      clearTimeout(t);
      if (idle !== undefined) g.cancelIdleCallback?.(idle);
    };
  }, [active, hasChain, chainReady]);

  const openArticle = () => Linking.openURL(story.url);
  const slide = () => pager.current?.scrollToEnd({ animated: true });
  const showChain = () => {
    if (chainReady) {
      slide();
      return;
    }
    // not built yet: build it first, then slide across once it's drawn (smooth, no half-drawn page)
    setChainReady(true);
    requestAnimationFrame(() => requestAnimationFrame(slide));
  };
  // stable, so the finished chain page is never redrawn just because the card changed
  const hideChain = useCallback(() => {
    pager.current?.scrollTo({ x: 0, animated: true });
  }, []);
  const share = () =>
    Share.share({
      message:
        `[${story.severity ?? 'Info'}] ${story.headline}\n\n` +
        (story.why_it_matters ? `${story.why_it_matters}\n\n` : '') +
        `${story.url}\n\nShared from CyberSid`,
    }).catch(() => {});

  const cardFace = (
    <View style={{ width: L.cardWidth, flex: 1 }}>
      <Pressable onPress={openArticle} style={{ height: L.imageHeight, backgroundColor: C.imageBg }} accessibilityLabel="Open article">
        {showImage ? (
          <>
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Image source={require('../../assets/logo-mark.png')} style={{ width: 44, height: 44, opacity: 0.25 }} contentFit="contain" />
            </View>
            <Image
              source={{ uri: story.image_url! }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
              priority={active ? 'high' : 'normal'}
              recyclingKey={story.id}
              cachePolicy="memory-disk"
              onError={() => setImageFailed(true)}
              accessibilityIgnoresInvertColors
            />
            <View style={styles.credit} pointerEvents="none">
              <Text style={styles.creditText} numberOfLines={1}>{aiImage ? 'AI illustration' : `Image: ${story.source}`}</Text>
            </View>
          </>
        ) : (
          <Cover story={story} height={L.imageHeight} width={L.cardWidth} iconSize={L.iconSize} />
        )}
      </Pressable>

      <View style={{ flex: 1, paddingHorizontal: L.pad, paddingTop: L.pad * 0.85 }}>
        {caughtUp && (
          <View style={styles.caught}>
            <MaterialCommunityIcons name="check-circle" size={L.metaSize + 2} color={C.brand} />
            <Text style={{ color: C.brandText, fontSize: L.metaSize - 0.5, fontFamily: F.label }}>You're all caught up. Earlier stories below.</Text>
          </View>
        )}
        <View style={[styles.tagRow, hasChain && { paddingRight: 52 * scale }]}>
          {isNew && (
            <View style={[styles.pill, { backgroundColor: C.brand }]}>
              <Text style={{ color: C.onBrand, fontSize: L.metaSize - 1, fontFamily: F.brand, letterSpacing: 0.5 }}>NEW</Text>
            </View>
          )}
          {showSeverity && (
            <View style={[styles.pill, { backgroundColor: sev.bg }]}>
              <Text style={{ color: sev.fg, fontSize: L.metaSize - 1, fontFamily: F.label }}>{story.severity}</Text>
            </View>
          )}
          {story.zero_day && (
            <View style={[styles.pill, styles.zeroPill]}>
              <MaterialCommunityIcons name="lightning-bolt" size={L.metaSize} color={C.zeroText} />
              <Text style={{ color: C.zeroText, fontSize: L.metaSize - 1, fontFamily: F.label }}>Zero-day</Text>
            </View>
          )}
          <View style={[styles.pill, { backgroundColor: tabColour(story.category, C) + (C.dark ? '26' : '17') }]}>
            <Text style={{ color: tabColour(story.category, C), fontSize: L.metaSize - 1, fontFamily: F.label }}>{story.category}</Text>
          </View>
        </View>
        <Text style={{ color: C.muted, fontSize: L.metaSize, marginTop: 6, paddingRight: hasChain ? 52 * scale : 0 }} numberOfLines={1}>
          {historyCard ? historyDate(story.id, story.published_at) : `${story.source} · ${timeAgo(story.published_at)}`}
        </Text>

        <Pressable onPress={openArticle}>
          <Text numberOfLines={4} style={{ color: C.text, fontFamily: F.head, fontSize: L.headlineSize, lineHeight: L.headlineLine, marginVertical: L.pad * 0.5 }}>
            {story.headline}
          </Text>
        </Pressable>

        {/* the summary gets whatever space is left and ends with "..." if it doesn't fit,
            so it can never push the buttons below over each other (big-text phones, iPhones) */}
        <Pressable
          style={{ flex: 1, overflow: 'hidden' }}
          onLayout={(e) => setBodyLines(Math.max(2, Math.floor(e.nativeEvent.layout.height / L.bodyLine)))}
          onPress={truncated ? () => setSheet('summary') : undefined}
          disabled={!truncated}
          accessibilityRole={truncated ? 'button' : undefined}
          accessibilityLabel={truncated ? 'Read the full summary' : undefined}
        >
          {/* invisible full-length copy, only measured, to know whether the summary was cut short */}
          <Text
            style={{ position: 'absolute', left: 0, right: 0, opacity: 0, fontSize: L.bodySize, lineHeight: L.bodyLine }}
            onLayout={(e) => setFullLines(Math.round(e.nativeEvent.layout.height / L.bodyLine))}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            {story.technical}
          </Text>
          <Text style={{ color: C.body, fontSize: L.bodySize, lineHeight: L.bodyLine }} numberOfLines={truncated ? Math.max(1, bodyLines - 1) : bodyLines} ellipsizeMode="tail">
            {story.technical}
          </Text>
          {truncated && (
            <Text style={{ color: C.brandDark, fontFamily: F.label, fontSize: L.metaSize, lineHeight: L.bodyLine }}>Read more</Text>
          )}
        </Pressable>


        {!!story.why_it_matters && (
          <View style={[styles.why, { padding: L.pad * 0.7, marginTop: L.pad * 0.6, marginBottom: action ? 0 : L.pad * 0.8 }]}>
            <View style={[styles.whyDot, { marginTop: L.bodyLine / 2 - 4 }]} />
            <Text numberOfLines={3} style={{ color: C.text, fontSize: L.bodySize - 1, lineHeight: L.bodyLine - 2, fontWeight: '600', flex: 1 }}>
              {story.why_it_matters}
            </Text>
          </View>
        )}

        {action && (
          <Pressable
            onPress={() => Linking.openURL(action.url)}
            style={[styles.actionBtn, { marginTop: L.pad * 0.6, marginBottom: L.pad * 0.8 }]}
            accessibilityRole="link"
          >
            <MaterialCommunityIcons name={action.icon} size={L.metaSize + 3} color={C.brandDark} />
            <Text style={{ color: C.brandDark, fontSize: L.metaSize + 0.5, fontFamily: F.label }}>{action.label}</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.footer, { paddingHorizontal: L.pad }]}>
        <View style={styles.iconRow}>
          <Pressable onPress={() => onToggleSave(story.id)} hitSlop={12} accessibilityLabel={saved ? 'Remove from saved' : 'Save story'}>
            <MaterialCommunityIcons name={saved ? 'bookmark' : 'bookmark-outline'} size={L.buttonIcon} color={saved ? C.brandDark : C.muted} />
          </Pressable>
          <Pressable onPress={share} hitSlop={12} accessibilityLabel="Share story">
            <MaterialCommunityIcons name="share-variant-outline" size={L.buttonIcon} color={C.muted} />
          </Pressable>
          <Pressable onPress={() => { setReportState('idle'); setSheet('report'); }} hitSlop={12} accessibilityLabel="Report an error">
            <MaterialCommunityIcons name="flag-outline" size={L.buttonIcon} color={C.muted} />
          </Pressable>
        </View>
        <Pressable onPress={openArticle} hitSlop={12} accessibilityRole="link" accessibilityLabel={`Read full story on ${story.source}`}>
          <Text style={{ color: C.brandDark, fontSize: L.metaSize + 1.5, fontFamily: F.label }}>Read full story</Text>
        </Pressable>
      </View>

      {hasChain && (
        <Animated.View
          style={[
            styles.tabWrap,
            {
              // just below the picture, beside the tags, never covering the image
              top: L.imageHeight + L.pad * 0.85 - 2,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.25] }),
            },
          ]}
        >
          <Pressable onPress={showChain} style={[styles.tab, { paddingVertical: 7 * scale, width: 46 * scale }]} accessibilityLabel="Show attack chain">
            <MaterialCommunityIcons name="link-variant" size={18 * scale} color={C.onBrand} />
            <Text style={[styles.tabText, { fontSize: 9.5 * scale }]}>CHAIN</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );

  return (
    <View style={[styles.page, { height }]}>
      <View style={[styles.card, { width: L.cardWidth, borderRadius: L.isTablet ? 24 : 18 }]}>
        {hasChain && (
          // revealed for a moment when the card slides to hint at the chain
          <View style={[styles.peekPanel, { width: L.cardWidth * 0.3 }]}>
            <MaterialCommunityIcons name="link-variant" size={26 * scale} color={C.onBrand} />
          </View>
        )}
        <Animated.View style={{ flex: 1, backgroundColor: C.card, transform: [{ translateX: nudge }] }}>
          {hasChain ? (
            <ScrollView
              ref={pager}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled
              directionalLockEnabled
              onScrollBeginDrag={() => setChainReady(true)}
            >
              {cardFace}
              <View style={{ width: L.cardWidth, flex: 1 }}>
                {chainReady ? (
                  <AttackChain story={story} scale={scale} width={L.cardWidth} onBack={hideChain} />
                ) : (
                  <View style={{ flex: 1, backgroundColor: '#221C1D' }} />
                )}
              </View>
            </ScrollView>
          ) : (
            cardFace
          )}
        </Animated.View>
      </View>

      {sheet === 'summary' && (
      <Sheet visible title={story.headline} onClose={() => setSheet(null)}>
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingHorizontal: 6, paddingBottom: 12 }}>
          <Text style={{ color: C.body, fontSize: 16, lineHeight: 24 }} selectable>{story.technical}</Text>
          {!!story.why_it_matters && (
            <Text style={{ color: C.text, fontSize: 15, lineHeight: 22, fontWeight: '600', marginTop: 14 }}>{story.why_it_matters}</Text>
          )}
          <Pressable onPress={() => { setSheet(null); openArticle(); }} style={{ marginTop: 16 }} accessibilityRole="link">
            <Text style={{ color: C.brandDark, fontFamily: F.label, fontSize: 15 }}>Read full story on {story.source}</Text>
          </Pressable>
        </ScrollView>
      </Sheet>
      )}

      {sheet === 'report' && (
      <Sheet visible title="Report an error" onClose={() => setSheet(null)}>
        {reportState === 'sent' ? (
          <Text style={styles.sheetMsg}>Thanks. We'll check this story.</Text>
        ) : reportState === 'failed' ? (
          <Text style={styles.sheetMsg}>Couldn't send that. Check your connection and try again.</Text>
        ) : (
          REPORT_REASONS.map((r: ReportReason) => (
            <SheetRow
              key={r}
              label={r}
              onPress={async () => {
                if (reportState === 'sending') return;
                setReportState('sending');
                setReportState((await sendReport(story.id, r)) ? 'sent' : 'failed');
              }}
            />
          ))
        )}
      </Sheet>
      )}
    </View>
  );
}

export const StoryCard = memo(StoryCardBase);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** History cards show the date of the event (kept in the card id: history:2017-05-12:wannacry),
 *  with "On this day" on its anniversary. */
function historyDate(id: string, posted: string) {
  const m = /^history:(\d{4})-(\d{2})(?:-(\d{2}))?:/.exec(id);
  if (!m) return `Cyber history · ${timeAgo(posted)}`;
  const [year, month, day] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0];
  const name = MONTHS[month - 1] ?? '';
  if (!day) return `${name} ${year}`;
  const now = new Date();
  const today = now.getDate() === day && now.getMonth() + 1 === month;
  return today ? `On this day · ${day} ${name} ${year}` : `${day} ${name} ${year}`;
}

const makeStyles = (C: Palette) =>
  StyleSheet.create({
  page: { alignItems: 'center', paddingVertical: 8 },
  card: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  zeroPill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 7, backgroundColor: C.zeroBg, borderWidth: 1, borderColor: C.zeroBorder },
  caught: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.imageBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  why: { flexDirection: 'row', gap: 9, backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 12 },
  whyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.brandDark },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1.5,
    borderColor: C.brandDark,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  iconRow: { flexDirection: 'row', gap: 22 },
  sheetMsg: { fontSize: 15, color: C.body, paddingVertical: 16, paddingHorizontal: 6 },
  tabWrap: { position: 'absolute', right: 0 },
  credit: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, maxWidth: '70%' },
  creditText: { color: '#fff', fontSize: 10.5, fontWeight: '600' },
  peekPanel: { position: 'absolute', right: 0, top: 0, bottom: 0, backgroundColor: C.brand, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 18 },
  tab: {
    alignItems: 'center',
    gap: 2,
    backgroundColor: C.brand,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  tabText: { color: C.onBrand, fontFamily: F.brand, letterSpacing: 0.8, marginTop: 1 },
});
