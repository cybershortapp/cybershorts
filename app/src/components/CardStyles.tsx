import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Image as RNImage, Pressable, StyleSheet, Text, type TextStyle, View, useWindowDimensions } from 'react-native';
import Svg, { Path, Polygon } from 'react-native-svg';

import { highlight, type Mark } from '../lib/highlight';
import { Justified } from './Justified';
import { timeAgo } from '../lib/time';
import type { Story } from '../lib/types';
import { type CardStyle, F, FS } from '../theme';

type Props = {
  story: Story;
  kind: Exclude<CardStyle, 'standard'>;
  width: number;
  height: number;
  saved: boolean;
  showImage: boolean;
  onImageError: () => void;
  onOpen: () => void;
  onSave: () => void;
  onShare: () => void;
  onReport: () => void;
  onReadMore: () => void;
  onChain?: () => void;
  onNext?: () => void;
};

/** Background of each style, so the card around it matches. */
export const STYLE_BG: Record<Props['kind'], string> = { magazine: '#000000', newspaper: '#F6F1E4', terminal: '#05070A', ronin: '#EFE6D2' };

/** The one label a card can have: Zero-day first, otherwise Critical. */
const labelOf = (s: Story) => (s.zero_day ? 'Zero-day' : s.severity === 'Critical' ? 'Critical' : null);
const aiPicture = (s: Story) => !!s.image_url && s.image_url.includes('/object/public/covers/');

/** The CHAIN tab, the same as on Standard cards: blue, at the right edge of the card, just below the picture. */
function ChainTab({ onPress, s, style }: { onPress: () => void; s: number; style?: object }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={[styles.chainTab, { paddingVertical: 7 * s, width: 46 * s }, style]} accessibilityLabel="Show attack chain">
      <MaterialCommunityIcons name="link-variant" size={18 * s} color="#FFFFFF" />
      <Text style={[styles.chainTabText, { fontSize: 9.5 * s }]}>CHAIN</Text>
    </Pressable>
  );
}

/** The summary with its key facts picked out (bold, colour), styled per card style. */
function Rich({ text, story, base, marks, lines, containerStyle }: {
  text: string; story: Story; base: TextStyle; marks: Record<Exclude<Mark, null>, TextStyle>; lines?: number; containerStyle?: object;
}) {
  const pieces = highlight(text, story).map((p) => ({ text: p.text, style: p.mark ? marks[p.mark] : undefined }));
  return <Justified pieces={pieces} style={base} lines={lines} containerStyle={containerStyle} />;
}

/** Works out how many lines of summary fit in the space left, so long stories end with "Read more". */
function useFit(lineHeight: number) {
  // bigger phone text makes every line taller: count lines at the real height
  lineHeight *= Math.max(1, useWindowDimensions().fontScale);
  const [lines, setLines] = useState(8);
  const [full, setFull] = useState(0);
  return {
    lines,
    cut: full > lines,
    onBox: (h: number) => setLines(Math.max(2, Math.floor(h / lineHeight))),
    onFull: (h: number) => setFull(Math.round(h / lineHeight)),
  };
}

export function StyledCard(p: Props) {
  if (p.kind === 'magazine') return <Magazine {...p} />;
  if (p.kind === 'newspaper') return <Newspaper {...p} />;
  if (p.kind === 'ronin') return <Ronin {...p} />;
  return <Terminal {...p} />;
}

// ---------------------------------------------------------------------------------------------------
// Magazine: a full cover. Scroll slowly and the article rises over the picture; a quick flick on the
// cover goes straight to the next story.
// ---------------------------------------------------------------------------------------------------
function Magazine({ story, width, height, saved, showImage, onImageError, onOpen, onSave, onShare, onReport, onChain, onNext }: Props) {
  const y = useRef(new Animated.Value(0)).current;
  const scroller = useRef<any>(null);
  const start = useRef(0);
  const box = useRef({ content: 0, view: 0 });
  const label = labelOf(story);
  const cover = Math.round(height * 0.66);
  const s = Math.min(width / 390, 1.3);

  const dim = y.interpolate({ inputRange: [0, cover * 0.6], outputRange: [1, 0.3], extrapolate: 'clamp' });
  const zoom = y.interpolate({ inputRange: [0, cover], outputRange: [1, 1.08], extrapolate: 'clamp' });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Animated.View style={[StyleSheet.absoluteFill, { height: cover + 40, opacity: dim, transform: [{ scale: zoom }] }]}>
        {showImage ? (
          <Image source={{ uri: story.image_url! }} style={StyleSheet.absoluteFill} contentFit="cover" onError={onImageError} recyclingKey={story.id} cachePolicy="memory-disk" />
        ) : (
          <LinearGradient colors={['#1d2b64', '#3a1f6e', '#5b1d4a']} style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']} locations={[0, 0.3]} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View style={[styles.magTop, { paddingHorizontal: 20 * s }]} pointerEvents="none">
        <Text style={[styles.magBrand, { fontSize: 13 * s }]}>CYBERSID</Text>
        {showImage && <Text style={styles.magCredit} numberOfLines={1}>{aiPicture(story) ? 'AI illustration' : `Image: ${story.source}`}</Text>}
      </View>

      <Animated.ScrollView
        ref={scroller}
        nestedScrollEnabled
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true })}
        onScrollBeginDrag={(e: any) => {
          start.current = e.nativeEvent.contentOffset.y;
        }}
        onLayout={(e: any) => {
          box.current.view = e.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_w: number, h: number) => {
          box.current.content = h;
        }}
        onScrollEndDrag={(e: any) => {
          if (!onNext) return;
          const now = e.nativeEvent.contentOffset.y;
          const v = Math.abs(e.nativeEvent.velocity?.y ?? 0);
          const end = Math.max(0, box.current.content - box.current.view);
          // a quick flick up while still on the cover: go to the next story instead of reading this one
          const flick = start.current < 30 && now > start.current && v > 1.6;
          // already at the end of the article and the finger pushes up again: go to the next story too
          const pastEnd = end > 0 && start.current >= end - 4 && now >= start.current - 1;
          if (flick || pastEnd) {
            onNext();
            requestAnimationFrame(() => scroller.current?.scrollTo?.({ y: 0, animated: false }));
          }
        }}
      >
        <Pressable onPress={onOpen} style={{ height: cover - 230 * s }} accessibilityLabel="Open article" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)', '#000']} locations={[0, 0.6, 1]} style={{ height: 90 * s }} />
        <View style={{ backgroundColor: '#000', paddingHorizontal: 22 * s, paddingBottom: 30 }}>
          {(!!label || !!onChain) && (
            <View style={{ minHeight: onChain ? 46 * s : 0, justifyContent: 'center', paddingRight: onChain ? 40 * s : 0 }}>
              {!!label && (
                <View style={[styles.magPill, { backgroundColor: '#FF4D3D' }]}>
                  {story.zero_day && <MaterialCommunityIcons name="lightning-bolt" size={13 * s} color="#fff" />}
                  <Text style={{ color: '#fff', fontFamily: F.head, fontSize: 12.5 * s }}>{label}</Text>
                </View>
              )}
              {!!onChain && <ChainTab onPress={onChain} s={s} style={{ position: 'absolute', top: 0, right: -22 * s }} />}
            </View>
          )}
          <Text style={{ color: '#fff', fontFamily: F.brand, fontSize: 33 * s, lineHeight: 37 * s, letterSpacing: -1, marginTop: 12 }}>{story.headline}</Text>
          <Text style={{ color: '#B8B8B8', fontFamily: F.medium, fontSize: 12.5 * s, marginTop: 12 }}>
            {story.source} · {timeAgo(story.published_at)}
          </Text>
          <Rich
            text={story.technical}
            story={story}
            base={{ color: '#EDEDED', fontFamily: FS.serif, fontSize: 17 * s, lineHeight: 29 * s }}
            containerStyle={{ marginTop: 18 }}
            marks={{
              cve: { fontFamily: F.head, color: '#FFFFFF' },
              product: { fontFamily: F.head, color: '#FFFFFF' },
              danger: { fontFamily: F.head, color: '#FFFFFF' },
              number: { fontFamily: F.head, color: '#FF8A7A' },
            }}
          />
          {!!story.why_it_matters && (
            <View style={styles.magBox}>
              <Justified pieces={[{ text: story.why_it_matters }]} style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 16 * s, lineHeight: 23 * s }} />
            </View>
          )}
          <Actions color="#FFFFFF" muted="#9A9A9A" saved={saved} onSave={onSave} onShare={onShare} onReport={onReport} onOpen={onOpen} s={s} pill />
          {!!onNext && (
            <Pressable onPress={onNext} style={{ alignSelf: 'center', marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 6 }} hitSlop={10}>
              <Text style={{ color: '#9A9A9A', fontFamily: F.medium, fontSize: 13 * s }}>Next story</Text>
              <MaterialCommunityIcons name="arrow-down" size={16 * s} color="#9A9A9A" />
            </Pressable>
          )}
        </View>
      </Animated.ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------
// Newspaper: a front page in one column.
// ---------------------------------------------------------------------------------------------------
const INK = '#141210';
const RED = '#A8201A';

function Newspaper({ story, width, height, saved, showImage, onImageError, onOpen, onSave, onShare, onReport, onReadMore, onChain }: Props) {
  const s = Math.min(width / 390, 1.3);
  const lh = 26 * s;
  const fit = useFit(lh);
  const label = labelOf(story);
  const date = new Date(story.published_at)
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .toUpperCase();
  const words = story.technical.split(' ');
  const lead = words.slice(0, 3).join(' ');
  const rest = ' ' + words.slice(3).join(' ');
  const body = { color: INK, fontFamily: FS.serif, fontSize: 16 * s, lineHeight: lh };
  const marks = {
    cve: { fontFamily: FS.serifBold },
    product: { fontFamily: FS.serifBold },
    danger: { fontFamily: FS.serifBold },
    number: { fontFamily: FS.serifBold, color: RED },
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#F6F1E4', paddingHorizontal: 18 * s, paddingTop: 14 * s }}>
      <Text style={{ fontFamily: FS.masthead, fontSize: 31 * s, color: INK, textAlign: 'center' }} numberOfLines={1} adjustsFontSizeToFit>
        The CyberSid Times
      </Text>
      <View style={styles.paperRule}>
        <Text style={[styles.paperMeta, { fontSize: 10.5 * s }]} numberOfLines={1}>{date}</Text>
        <Text style={[styles.paperMeta, { fontSize: 10.5 * s }]}>{timeAgo(story.published_at)}</Text>
      </View>
      {!!label && <Text style={{ color: RED, fontFamily: F.head, fontSize: 12 * s, letterSpacing: 1.5, textAlign: 'center', marginTop: 10 }}>{label.toUpperCase()}</Text>}
      <Pressable onPress={onOpen}>
        <Text style={{ fontFamily: FS.display, fontSize: 29 * s, lineHeight: 33 * s, color: INK, textAlign: 'center', marginTop: label ? 4 : 12 }} numberOfLines={4}>
          {story.headline}
        </Text>
      </Pressable>
      {showImage && (
        <Pressable onPress={onOpen} style={{ height: Math.round(height * 0.2), marginTop: 12, backgroundColor: '#DDD6C5' }}>
          <Image
            source={{ uri: story.image_url! }}
            style={[StyleSheet.absoluteFill, { filter: 'grayscale(1) contrast(1.2)' } as object]}
            contentFit="cover"
            onError={onImageError}
            recyclingKey={story.id}
            cachePolicy="memory-disk"
          />
        </Pressable>
      )}
      <View style={{ minHeight: onChain ? 46 * s : 0, paddingRight: onChain ? 36 * s : 0, marginTop: 4, justifyContent: onChain ? 'center' : 'flex-start' }}>
        <Text style={{ fontFamily: F.medium, fontSize: 11 * s, color: '#4A453A' }} numberOfLines={1}>
          {showImage ? (aiPicture(story) ? 'Illustration' : 'Picture') + ' · ' : ''}Reported by {story.source}
        </Text>
        {!!onChain && <ChainTab onPress={onChain} s={s} style={{ position: 'absolute', top: 0, right: -18 * s }} />}
      </View>

      <Pressable style={{ flex: 1, overflow: 'hidden', marginTop: 10 }} onLayout={(e) => fit.onBox(e.nativeEvent.layout.height)} onPress={fit.cut ? onReadMore : undefined} disabled={!fit.cut}>
        <Text style={[body, { position: 'absolute', left: 0, right: 0, opacity: 0 }]} onLayout={(e) => fit.onFull(e.nativeEvent.layout.height)} accessible={false}>
          {story.technical}
        </Text>
        <Justified
          pieces={[{ text: lead, style: { fontFamily: FS.serifBold } }, ...highlight(rest, story).map((pc) => ({ text: pc.text, style: pc.mark ? marks[pc.mark] : undefined }))]}
          style={body}
          lines={fit.cut ? Math.max(1, fit.lines - 1) : fit.lines}
        />
        {fit.cut && <Text style={{ fontFamily: F.head, fontSize: 13 * s, color: RED, lineHeight: lh }}>Read more</Text>}
      </Pressable>

      {!!story.why_it_matters && (
        <View style={styles.paperWhy}>
          <Justified pieces={[{ text: story.why_it_matters }]} style={{ fontFamily: F.label, fontSize: 14.5 * s, lineHeight: 21 * s, color: INK }} lines={3} />
        </View>
      )}
      <Actions color={INK} muted="#5C564A" saved={saved} onSave={onSave} onShare={onShare} onReport={onReport} onOpen={onOpen} s={s} />
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------
// Terminal: the story printed in a hacker's terminal.
// ---------------------------------------------------------------------------------------------------
const GREEN = '#4ADE80';
const DIM = '#86A894';

function Terminal({ story, width, saved, showImage, onImageError, onOpen, onSave, onShare, onReport, onReadMore, onChain }: Props) {
  const s = Math.min(width / 390, 1.3);
  const lh = 23 * s;
  const fit = useFit(lh);
  const label = labelOf(story);
  const body = { color: '#E9FFF0', fontFamily: FS.mono, fontSize: 14.5 * s, lineHeight: lh };
  const marks = {
    cve: { color: '#7DD3FC', fontFamily: FS.monoBold },
    product: { color: '#FFFFFF', fontFamily: FS.monoBold },
    danger: { color: '#FFB86B', fontFamily: FS.monoBold },
    number: { color: '#FFB86B', fontFamily: FS.monoBold },
  };
  const mono = (size: number, color = DIM) => ({ fontFamily: FS.mono, fontSize: size * s, color });

  return (
    <View style={{ flex: 1, backgroundColor: '#05070A' }}>
      <View style={{ flex: 1, paddingHorizontal: 18 * s, paddingTop: 16 * s }}>
        <Text style={mono(13.5, GREEN)} numberOfLines={1}>
          reader@cybersid:~$ <Text style={{ color: '#FFFFFF' }}>news --latest</Text>
        </Text>
        <Text style={mono(12)} numberOfLines={1}>source: {story.source.toLowerCase()} · {timeAgo(story.published_at)}</Text>

        {showImage && (
          // the story picture in a terminal window, in green screen colours with scan lines
          <Pressable onPress={onOpen} style={styles.termWin} accessibilityRole="imagebutton" accessibilityLabel="Story picture, opens the full story">
            <View style={styles.termWinBar}>
              <View style={[styles.termDot, { backgroundColor: '#FF5F57' }]} />
              <View style={[styles.termDot, { backgroundColor: '#FEBC2E' }]} />
              <View style={[styles.termDot, { backgroundColor: '#28C840' }]} />
              <Text style={[mono(11), { marginLeft: 6 }]} numberOfLines={1}>{aiPicture(story) ? 'illustration.jpg' : 'cover.jpg'}</Text>
            </View>
            <View style={{ height: Math.round((width - 36 * s) * 0.4), backgroundColor: '#0B1A12' }}>
              <Image
                source={{ uri: story.image_url! }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={150}
                onError={onImageError}
                recyclingKey={story.id}
                cachePolicy="memory-disk"
              />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#2BE07A', mixBlendMode: 'color', opacity: 0.9 }]} />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,20,8,0.18)' }]} />
              <RNImage source={require('../../assets/scanlines.png')} resizeMode="repeat" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />
            </View>
          </Pressable>
        )}

        <View>
        {!!onChain && <ChainTab onPress={onChain} s={s} style={{ position: 'absolute', top: 14, right: -18 * s, zIndex: 2 }} />}
        <Pressable onPress={onOpen} style={[styles.termBox, !!onChain && { marginRight: 30 * s }]}>
          {!!label && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Text style={{ backgroundColor: '#FF4D4D', color: '#000', fontFamily: FS.monoBold, fontSize: 12.5 * s, paddingHorizontal: 7, paddingVertical: 1 }}>
                {label.toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={{ color: '#FFFFFF', fontFamily: FS.monoBold, fontSize: 19 * s, lineHeight: 26 * s }} numberOfLines={3}>{story.headline}</Text>
        </Pressable>
        </View>

        <Text style={[mono(13), { marginTop: 16 }]}>&gt; cat summary.txt</Text>
        <Pressable style={{ flex: 1, overflow: 'hidden' }} onLayout={(e) => fit.onBox(e.nativeEvent.layout.height)} onPress={fit.cut ? onReadMore : undefined} disabled={!fit.cut}>
          <Text style={[body, { position: 'absolute', left: 0, right: 0, opacity: 0 }]} onLayout={(e) => fit.onFull(e.nativeEvent.layout.height)} accessible={false}>
            {story.technical}
          </Text>
          <Rich text={story.technical} story={story} base={body} marks={marks} lines={fit.cut ? Math.max(1, fit.lines - 1) : fit.lines} />
          {fit.cut && <Text style={[mono(13, GREEN), { lineHeight: lh }]}>&gt; less summary.txt</Text>}
        </Pressable>

        {!!story.why_it_matters && (
          <>
            <Text style={[mono(13), { marginTop: 10 }]}>&gt; ./takeaway</Text>
            <Justified pieces={[{ text: `[!] ${story.why_it_matters}` }]} style={{ color: GREEN, fontFamily: FS.monoBold, fontSize: 14.5 * s, lineHeight: lh }} lines={3} />
          </>
        )}
      </View>
      <View style={styles.termBar}>
        <Pressable onPress={onSave} hitSlop={8} accessibilityLabel={saved ? 'Remove from saved' : 'Save story'}>
          <Text style={mono(12.5, saved ? GREEN : '#B5D3C1')}>{saved ? '[saved]' : 'save'}</Text>
        </Pressable>
        <Pressable onPress={onShare} hitSlop={8} accessibilityLabel="Share story"><Text style={mono(12.5, '#B5D3C1')}>share</Text></Pressable>
        <Pressable onPress={onReport} hitSlop={8} accessibilityLabel="Report an error"><Text style={mono(12.5, '#B5D3C1')}>report</Text></Pressable>
        <Pressable onPress={onOpen} hitSlop={8} accessibilityRole="link" style={{ marginLeft: 'auto' }}>
          <Text style={mono(12.5, GREEN)}>read full story ›</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------
// Ronin: ink on rice paper. A brush-edged picture, a red seal, a sword slash under the headline.
// ---------------------------------------------------------------------------------------------------
const PAPER = '#EFE6D2';
const SUMI = '#16120E';
const SEAL = '#B3261E';

/** Torn, brush-like paper edges laid over the top and bottom of the picture. */
function BrushEdges({ width, height }: { width: number; height: number }) {
  const w = width;
  const top = `0,0 ${w},0 ${w},7 ${w * 0.88},3 ${w * 0.7},8 ${w * 0.52},2 ${w * 0.33},7 ${w * 0.17},1 0,9`;
  const bottom = `0,${height} ${w},${height} ${w},${height - 9} ${w * 0.85},${height - 3} ${w * 0.66},${height - 10} ${w * 0.47},${height - 4} ${w * 0.29},${height - 11} ${w * 0.12},${height - 3} 0,${height - 8}`;
  return (
    <Svg width={w} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Polygon points={top} fill={PAPER} />
      <Polygon points={bottom} fill={PAPER} />
    </Svg>
  );
}

function Ronin({ story, width, height, saved, showImage, onImageError, onOpen, onSave, onShare, onReport, onReadMore, onChain }: Props) {
  const s = Math.min(width / 390, 1.3);
  const lh = 24 * s;
  const fit = useFit(lh);
  const label = labelOf(story);
  const slash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slash, { toValue: 1, duration: 520, delay: 180, useNativeDriver: true }).start();
  }, [slash]);
  const picW = width - 40 * s - 26 * s;
  const picH = Math.round(height * 0.27);
  const body = { color: '#2E271F', fontFamily: F.body, fontSize: 15 * s, lineHeight: lh };
  const marks = {
    cve: { fontFamily: F.head, color: SUMI },
    product: { fontFamily: F.head, color: SUMI },
    danger: { fontFamily: F.head, color: SEAL },
    number: { fontFamily: F.head, color: SEAL },
  };
  const kanji = story.zero_day || story.severity === 'Critical' ? '危' : '報';
  const sealText = label ? label.toUpperCase() : 'NEWS';

  return (
    <View style={{ flex: 1, backgroundColor: PAPER }}>
      <LinearGradient colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0)', 'rgba(120,90,50,0.10)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      {/* faint ink mountains and a red sun, behind everything */}
      <Svg width={width} height={150 * s} viewBox="0 0 390 150" style={{ position: 'absolute', left: 0, bottom: 52 * s }} pointerEvents="none">
        <Path d="M0 150 L0 98 Q40 70 70 88 Q100 46 135 80 Q160 60 190 86 Q230 30 268 74 Q300 52 330 84 Q360 66 390 80 L390 150 Z" fill={SUMI} opacity={0.07} />
        <Path d="M0 150 L0 118 Q55 92 96 112 Q140 84 182 110 Q236 80 290 108 Q340 90 390 104 L390 150 Z" fill={SUMI} opacity={0.11} />
      </Svg>
      <View style={{ flex: 1, paddingLeft: 20 * s, paddingRight: 26 * s, paddingTop: 18 * s }}>
        {showImage ? (
          <Pressable onPress={onOpen} style={{ width: picW, height: picH }} accessibilityRole="imagebutton" accessibilityLabel="Story picture, opens the full story">
            <Image
              source={{ uri: story.image_url! }}
              style={[StyleSheet.absoluteFill, { filter: 'grayscale(0.85) contrast(1.15) sepia(0.3)' } as object]}
              contentFit="cover"
              onError={onImageError}
              recyclingKey={story.id}
              cachePolicy="memory-disk"
            />
            <BrushEdges width={picW} height={picH} />
          </Pressable>
        ) : (
          <View style={{ width: picW, height: picH * 0.55, justifyContent: 'center' }}>
            <View style={{ height: 3, width: picW * 0.4, backgroundColor: SUMI, opacity: 0.6 }} />
          </View>
        )}
        {/* the red seal, stamped over the corner of the picture */}
        <View style={[styles.seal, { width: 70 * s, height: 70 * s, top: 18 * s + (showImage ? picH : picH * 0.55) - 46 * s, right: 18 * s }]} pointerEvents="none">
          <Text style={{ color: '#FFF4EA', fontFamily: FS.ink, fontSize: 28 * s, lineHeight: 30 * s }}>{kanji}</Text>
          <Text style={{ color: '#FFF4EA', fontFamily: F.head, fontSize: 8 * s, letterSpacing: 1.2, marginTop: 1 }} numberOfLines={1}>{sealText}</Text>
        </View>

        {/* category and time, with the CHAIN tab at the right edge just below the picture */}
        <View style={{ minHeight: onChain ? 46 * s : 0, justifyContent: 'center', paddingRight: onChain ? 70 * s : 60 * s, marginTop: 12 * s }}>
          <Text style={{ color: SEAL, fontFamily: F.head, fontSize: 11 * s, letterSpacing: 2.5 }} numberOfLines={1}>
            {(story.category || 'News').toUpperCase()} · {story.source.toUpperCase()}
          </Text>
          {!!onChain && <ChainTab onPress={onChain} s={s} style={{ position: 'absolute', top: 0, right: -26 * s }} />}
        </View>

        <Pressable onPress={onOpen}>
          <Text style={{ color: SUMI, fontFamily: FS.ink, fontSize: 29 * s, lineHeight: 32 * s, marginTop: 6 * s }} numberOfLines={4}>
            {story.headline}
          </Text>
        </Pressable>
        {/* the sword slash */}
        <Animated.View style={{ marginTop: 10 * s, marginLeft: -20 * s, width: picW * 0.9, height: 6, transform: [{ scaleX: slash }], transformOrigin: 'left' } as object}>
          <Svg width={picW * 0.9} height={6}>
            <Polygon points={`0,2.5 ${picW * 0.9},0 ${picW * 0.9 - 40},3 ${picW * 0.9},6 0,3.5`} fill={SUMI} />
          </Svg>
        </Animated.View>

        <Pressable style={{ flex: 1, overflow: 'hidden', marginTop: 10 * s }} onLayout={(e) => fit.onBox(e.nativeEvent.layout.height)} onPress={fit.cut ? onReadMore : undefined} disabled={!fit.cut}>
          <Text style={[body, { position: 'absolute', left: 0, right: 0, opacity: 0 }]} onLayout={(e) => fit.onFull(e.nativeEvent.layout.height)} accessible={false}>
            {story.technical}
          </Text>
          <Rich text={story.technical} story={story} base={body} marks={marks} lines={fit.cut ? Math.max(1, fit.lines - 1) : fit.lines} />
          {fit.cut && <Text style={{ fontFamily: F.head, fontSize: 13 * s, color: SEAL, lineHeight: lh }}>Read the scroll</Text>}
        </Pressable>

        {!!story.why_it_matters && (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 * s }}>
            <View style={{ width: 3, backgroundColor: SEAL, borderRadius: 2 }} />
            <Justified pieces={[{ text: story.why_it_matters }]} style={{ color: SUMI, fontFamily: F.label, fontSize: 14 * s, lineHeight: 20 * s }} lines={3} containerStyle={{ flex: 1 }} />
          </View>
        )}
        <Actions color={SUMI} muted="#5A5045" saved={saved} onSave={onSave} onShare={onShare} onReport={onReport} onOpen={onOpen} s={s} />
      </View>
    </View>
  );
}

/** Save, share, report, attack chain and "Read full story", in the colours of the style. */
function Actions({ color, muted, saved, onSave, onShare, onReport, onChain, onOpen, s, pill }: {
  color: string; muted: string; saved: boolean; onSave: () => void; onShare: () => void; onReport: () => void;
  onChain?: () => void; onOpen: () => void; s: number; pill?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 12, marginTop: pill ? 14 : 0 }}>
      <Pressable onPress={onSave} hitSlop={10} accessibilityLabel={saved ? 'Remove from saved' : 'Save story'}>
        <MaterialCommunityIcons name={saved ? 'bookmark' : 'bookmark-outline'} size={22 * s} color={saved ? color : muted} />
      </Pressable>
      <Pressable onPress={onShare} hitSlop={10} accessibilityLabel="Share story">
        <MaterialCommunityIcons name="share-variant-outline" size={22 * s} color={muted} />
      </Pressable>
      <Pressable onPress={onReport} hitSlop={10} accessibilityLabel="Report an error">
        <MaterialCommunityIcons name="flag-outline" size={22 * s} color={muted} />
      </Pressable>
      {!!onChain && (
        <Pressable onPress={onChain} hitSlop={10} accessibilityLabel="Show attack chain">
          <MaterialCommunityIcons name="link-variant" size={22 * s} color={muted} />
        </Pressable>
      )}
      <Pressable
        onPress={onOpen}
        hitSlop={8}
        accessibilityRole="link"
        style={[{ marginLeft: 'auto' }, pill && { backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 }]}
      >
        <Text style={{ color: pill ? '#000000' : color, fontFamily: F.label, fontSize: 14 * s, textDecorationLine: pill ? 'none' : 'underline' }}>
          Read full story
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  magTop: { position: 'absolute', top: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 },
  magBrand: { color: '#FFFFFF', fontFamily: F.brand, letterSpacing: 2.5 },
  magCredit: { color: 'rgba(255,255,255,0.5)', fontFamily: F.medium, fontSize: 9.5, maxWidth: '60%' },
  magPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  magBox: { marginTop: 18, padding: 14, borderRadius: 16, backgroundColor: '#1A1A1A', borderLeftWidth: 4, borderLeftColor: '#FF6B57' },
  paperRule: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 2, borderBottomWidth: 1, borderColor: INK, paddingVertical: 4, marginTop: 4 },
  paperMeta: { fontFamily: F.label, color: INK },
  paperWhy: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: INK, paddingVertical: 8, marginTop: 8 },
  termBox: { marginTop: 14, borderWidth: 1, borderColor: '#2A3D32', borderRadius: 8, padding: 14 },
  termWin: { marginTop: 12, borderWidth: 1, borderColor: '#2A3D32', borderRadius: 8, overflow: 'hidden' },
  termWinBar: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#0E1511', borderBottomWidth: 1, borderBottomColor: '#2A3D32' },
  termDot: { width: 8, height: 8, borderRadius: 4 },
  seal: { position: 'absolute', borderRadius: 8, backgroundColor: SEAL, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: PAPER, transform: [{ rotate: '-8deg' }] },
  chainTab: { alignItems: 'center', gap: 2, backgroundColor: '#2563F5', borderTopLeftRadius: 14, borderBottomLeftRadius: 14 },
  chainTabText: { color: '#FFFFFF', fontFamily: F.brand, letterSpacing: 0.8, marginTop: 1 },
  termBar: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 44, paddingHorizontal: 18, backgroundColor: '#0E1912', borderTopWidth: 1, borderTopColor: '#1D2B23' },
});
