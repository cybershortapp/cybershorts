import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { actionFor } from '../lib/actions';
import { SHOW_SOURCE_IMAGES } from '../lib/config';
import { sendReport } from '../lib/report';
import { REPORT_REASONS, type ReportReason } from '../lib/types';
import { useCardLayout } from '../lib/layout';
import { timeAgo } from '../lib/time';
import type { Story } from '../lib/types';
import { F, type Palette, severityOf, storyTint, tabColour, useCardStyle, useTheme } from '../theme';
import { AttackChain } from './AttackChain';
import { STYLE_BG, StyledCard } from './CardStyles';
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
  onNext?: () => void; // Magazine: a quick flick on the cover goes to the next story
};

function StoryCardBase({ story, height, active, saved, onToggleSave, isNew, caughtUp, onNext }: Props) {
  const C = useTheme();
  const cardStyle = useCardStyle();
  const styled = cardStyle !== 'standard';
  const styles = useMemo(() => makeStyles(C), [C]);
  const L = useCardLayout(height);
  // Vivid: a card in the colour of the story's picture. Aurora: a glass card. Light and Dark: a plain card.
  const vivid = C.mode === 'vivid';
  const tint = storyTint(story);
  const cardWidth = L.cardWidth;
  const imageHeight = L.imageHeight;
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
      const peek = Math.round(cardWidth * 0.2);
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
  }, [active, hasChain, pulse, cardWidth]);

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

  const standardFace = (
    <View style={{ width: cardWidth, flex: 1 }}>
      <Pressable onPress={openArticle} style={{ height: imageHeight, backgroundColor: C.imageBg }} accessibilityLabel="Open article">
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
          </>
        ) : (
          <Cover story={story} height={imageHeight} width={cardWidth} iconSize={L.iconSize} />
        )}
        {vivid && (
          // the picture fades into the story's colour, so picture and text read as one
          <LinearGradient
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)', tint + 'B3', tint]}
            locations={[0, 0.45, 0.82, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}
        {showImage && (
          // small and faint, so the eye isn't drawn to it, but still there to credit the picture
          <Text style={styles.credit} numberOfLines={1} pointerEvents="none">
            {aiImage ? 'AI illustration' : `Image: ${story.source}`}
          </Text>
        )}
      </Pressable>

      <View style={{ flex: 1, paddingHorizontal: L.pad, paddingTop: L.pad * 0.85 }}>
        {caughtUp && (
          <View style={styles.caught}>
            <MaterialCommunityIcons name="check-circle" size={L.metaSize + 2} color={C.brand} />
            <Text style={{ color: C.brandText, fontSize: L.metaSize - 0.5, fontFamily: F.label }}>You're all caught up. Earlier stories below.</Text>
          </View>
        )}
        {/* one label only, and only when it matters: Zero-day first, otherwise Critical */}
        {(story.zero_day || story.severity === 'Critical') && (
          <View style={[styles.tagRow, hasChain && { paddingRight: 52 * scale }]}>
            {story.zero_day ? (
              <View style={[styles.pill, C.glass ? styles.glassPill : styles.zeroPill]}>
                <MaterialCommunityIcons name="lightning-bolt" size={L.metaSize} color={C.glass ? '#FF8A65' : C.zeroText} />
                <Text style={{ color: C.glass ? C.text : C.zeroText, fontSize: L.metaSize - 1, fontFamily: F.label }}>Zero-day</Text>
              </View>
            ) : C.glass ? (
              <View style={[styles.pill, styles.glassPill]}>
                <View style={[styles.sevDot, { backgroundColor: sev.accent, shadowColor: sev.accent }]} />
                <Text style={{ color: C.text, fontSize: L.metaSize - 1, fontFamily: F.label }}>Critical</Text>
              </View>
            ) : (
              <View style={[styles.pill, { backgroundColor: sev.bg }]}>
                <Text style={{ color: sev.fg, fontSize: L.metaSize - 1, fontFamily: F.label }}>Critical</Text>
              </View>
            )}
          </View>
        )}
        <Text style={{ color: C.muted, opacity: 0.85, fontSize: L.metaSize - 1, fontFamily: F.body, marginTop: 7, paddingRight: hasChain ? 52 * scale : 0 }} numberOfLines={1}>
          {historyCard ? historyDate(story.id, story.published_at) : `${story.source} · ${timeAgo(story.published_at)}`}
        </Text>

        <Pressable onPress={openArticle}>
          <Text numberOfLines={4} style={{ color: C.text, fontFamily: F.head, fontSize: L.headlineSize + (C.glass ? 2 : 1), lineHeight: L.headlineLine + (C.glass ? 2 : 1), letterSpacing: -0.4, marginVertical: L.pad * 0.5 }}>
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
            style={{ position: 'absolute', left: 0, right: 0, opacity: 0, fontSize: L.bodySize, lineHeight: L.bodyLine, fontFamily: F.body, textAlign: 'justify' }}
            android_hyphenationFrequency="normal"
            onLayout={(e) => setFullLines(Math.round(e.nativeEvent.layout.height / L.bodyLine))}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
          >
            {story.technical}
          </Text>
          <Text style={{ color: C.body, fontSize: L.bodySize, lineHeight: L.bodyLine, fontFamily: F.body, textAlign: 'justify' }} numberOfLines={truncated ? Math.max(1, bodyLines - 1) : bodyLines} ellipsizeMode="clip" android_hyphenationFrequency="normal">
            {story.technical}
          </Text>
          {truncated && (
            <Text style={{ color: C.brandDark, fontFamily: F.label, fontSize: L.metaSize, lineHeight: L.bodyLine }}>Read more</Text>
          )}
        </Pressable>


        {!!story.why_it_matters && (
          <View style={[styles.why, { padding: L.pad * 0.75, marginTop: L.pad * 0.6, marginBottom: action ? 0 : L.pad * 0.8 }]}>
            <Text numberOfLines={3} ellipsizeMode="clip" android_hyphenationFrequency="normal" style={{ color: C.text, fontSize: L.bodySize - 1, lineHeight: L.bodyLine - 2, fontFamily: F.label, flex: 1, textAlign: 'justify' }}>
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

      <View style={[styles.dock, { marginHorizontal: 10, marginBottom: 10, paddingLeft: L.pad }]}>
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
        <Pressable onPress={openArticle} hitSlop={8} style={styles.read} accessibilityRole="link" accessibilityLabel={`Read full story on ${story.source}`}>
          <Text style={{ color: C.glass || C.dark ? '#000000' : '#FFFFFF', fontSize: L.metaSize + 1.5, fontFamily: F.label }}>
            {historyCard ? 'Read the story' : 'Read full story'}
          </Text>
        </Pressable>
      </View>

      {hasChain && (
        <Animated.View
          style={[
            styles.tabWrap,
            {
              // just below the picture, beside the tags, never covering the image
              top: imageHeight + L.pad * 0.85 - 2,
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

  // the chain page matches the card: a styled card's own paper (cream Newspaper, black Magazine and Terminal), else the theme
  const chainLook: { bg?: string; look?: 'light' | 'dark' } = styled
    ? { bg: STYLE_BG[cardStyle as keyof typeof STYLE_BG], look: cardStyle === 'newspaper' ? 'light' : 'dark' }
    : { bg: vivid ? tint : undefined };

  // the reader's card style (Standard, Magazine, Newspaper or Terminal); all of them can open the attack chain
  const cardFace = styled ? (
    <View style={{ width: cardWidth, flex: 1 }}>
      <StyledCard
        story={story}
        kind={cardStyle as Exclude<typeof cardStyle, 'standard'>}
        width={cardWidth}
        height={height - 16}
        saved={saved}
        showImage={showImage}
        onImageError={() => setImageFailed(true)}
        onOpen={openArticle}
        onSave={() => onToggleSave(story.id)}
        onShare={share}
        onReport={() => { setReportState('idle'); setSheet('report'); }}
        onReadMore={() => setSheet('summary')}
        onChain={hasChain ? showChain : undefined}
        onNext={onNext}
      />
    </View>
  ) : (
    standardFace
  );

  return (
    <View style={[styles.page, { height }]}>
      <View
        style={[
          styles.card,
          { width: cardWidth, borderRadius: L.isTablet ? 28 : 24 },
          vivid && !styled && { backgroundColor: tint, borderColor: 'rgba(255,255,255,0.2)' },
          C.mode === 'aurora' && !styled && { backgroundColor: 'rgba(255,255,255,0.08)' },
          styled && { backgroundColor: STYLE_BG[cardStyle as keyof typeof STYLE_BG], borderColor: cardStyle === 'newspaper' ? '#D9D0BB' : '#22262E' },
        ]}
      >
        {hasChain && C.mode !== 'aurora' && !styled && (
          // revealed for a moment when the card slides to hint at the chain (Aurora's see-through card would show it all the time)
          <View style={[styles.peekPanel, { width: cardWidth * 0.3 }]}>
            <MaterialCommunityIcons name="link-variant" size={26 * scale} color={C.onBrand} />
          </View>
        )}
        <Animated.View style={{ flex: 1, backgroundColor: styled ? STYLE_BG[cardStyle as keyof typeof STYLE_BG] : vivid ? tint : C.card, transform: [{ translateX: nudge }] }}>
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
              <View style={{ width: cardWidth, flex: 1 }}>
                {chainReady ? (
                  <AttackChain story={story} scale={scale} width={cardWidth} onBack={hideChain} {...chainLook} />
                ) : (
                  <View style={{ flex: 1, backgroundColor: chainLook.bg ?? C.card }} />
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
          <Text style={{ color: C.body, fontSize: 16, lineHeight: 24, textAlign: 'justify' }} selectable android_hyphenationFrequency="normal">{story.technical}</Text>
          {!!story.why_it_matters && (
            <Text style={{ color: C.text, fontSize: 15, lineHeight: 22, fontWeight: '600', marginTop: 14, textAlign: 'justify' }} android_hyphenationFrequency="normal">{story.why_it_matters}</Text>
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
  glassPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  sevDot: { width: 6, height: 6, borderRadius: 3, shadowOpacity: 0.9, shadowRadius: 4, elevation: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  pill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  zeroPill: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 7, backgroundColor: C.zeroBg, borderWidth: 1, borderColor: C.zeroBorder },
  caught: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.imageBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 8 },
  why: { flexDirection: 'row', backgroundColor: C.glass ? C.surface : C.dark ? '#1E2638' : '#F1F3F8', borderWidth: C.glass ? 1 : 0, borderColor: C.border, borderRadius: 18 },
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
  // the floating bar at the bottom: save, share, report, and the main button
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingRight: 6,
    borderRadius: 999,
    backgroundColor: C.glass ? C.surface : C.dark ? '#1E2638' : '#F1F3F8',
    borderWidth: C.glass ? 1 : 0,
    borderColor: C.border,
  },
  read: { backgroundColor: C.glass || C.dark ? '#FFFFFF' : '#111827', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  iconRow: { flexDirection: 'row', gap: 22 },
  sheetMsg: { fontSize: 15, color: C.body, paddingVertical: 16, paddingHorizontal: 6 },
  tabWrap: { position: 'absolute', right: 0 },
  credit: {
    position: 'absolute', right: 12, bottom: 8, maxWidth: '70%', color: 'rgba(255,255,255,0.5)', fontSize: 9.5, fontFamily: F.medium,
    textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 3,
  },
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
