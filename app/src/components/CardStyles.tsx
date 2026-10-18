import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRef, useState } from 'react';
import { Animated, Image as RNImage, Pressable, StyleSheet, Text, type TextStyle, View } from 'react-native';

import { highlight, type Mark } from '../lib/highlight';
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
export const STYLE_BG: Record<Props['kind'], string> = { magazine: '#000000', newspaper: '#F6F1E4', terminal: '#05070A' };

/** The one label a card can have: Zero-day first, otherwise Critical. */
const labelOf = (s: Story) => (s.zero_day ? 'Zero-day' : s.severity === 'Critical' ? 'Critical' : null);
const aiPicture = (s: Story) => !!s.image_url && s.image_url.includes('/object/public/covers/');

/** The summary with its key facts picked out (bold, colour), styled per card style. */
function Rich({ text, story, base, marks, lines }: {
  text: string; story: Story; base: TextStyle; marks: Record<Exclude<Mark, null>, TextStyle>; lines?: number;
}) {
  return (
    <Text style={base} numberOfLines={lines} ellipsizeMode="tail" android_hyphenationFrequency="normal">
      {highlight(text, story).map((p, i) => (p.mark ? <Text key={i} style={marks[p.mark]}>{p.text}</Text> : p.text))}
    </Text>
  );
}

/** Works out how many lines of summary fit in the space left, so long stories end with "Read more". */
function useFit(lineHeight: number) {
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
        onScrollEndDrag={(e: any) => {
          // a quick flick up while still on the cover: go to the next story instead of reading this one
          const v = Math.abs(e.nativeEvent.velocity?.y ?? 0);
          if (onNext && start.current < 30 && e.nativeEvent.contentOffset.y > start.current && v > 1.6) {
            onNext();
            requestAnimationFrame(() => scroller.current?.scrollTo?.({ y: 0, animated: false }));
          }
        }}
      >
        <Pressable onPress={onOpen} style={{ height: cover - 230 * s }} accessibilityLabel="Open article" />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.85)', '#000']} locations={[0, 0.6, 1]} style={{ height: 90 * s }} />
        <View style={{ backgroundColor: '#000', paddingHorizontal: 22 * s, paddingBottom: 30 }}>
          {!!label && (
            <View style={[styles.magPill, { backgroundColor: '#FF4D3D' }]}>
              {story.zero_day && <MaterialCommunityIcons name="lightning-bolt" size={13 * s} color="#fff" />}
              <Text style={{ color: '#fff', fontFamily: F.head, fontSize: 12.5 * s }}>{label}</Text>
            </View>
          )}
          <Text style={{ color: '#fff', fontFamily: F.brand, fontSize: 33 * s, lineHeight: 37 * s, letterSpacing: -1, marginTop: 12 }}>{story.headline}</Text>
          <Text style={{ color: '#B8B8B8', fontFamily: F.medium, fontSize: 12.5 * s, marginTop: 12 }}>
            {story.source} · {timeAgo(story.published_at)}
          </Text>
          <Rich
            text={story.technical}
            story={story}
            base={{ color: '#EDEDED', fontFamily: FS.serif, fontSize: 17 * s, lineHeight: 29 * s, marginTop: 18, textAlign: 'justify' }}
            marks={{
              cve: { fontFamily: F.head, color: '#FFFFFF' },
              product: { fontFamily: F.head, color: '#FFFFFF' },
              danger: { fontFamily: F.head, color: '#FFFFFF' },
              number: { fontFamily: F.head, color: '#FF8A7A' },
            }}
          />
          {!!story.why_it_matters && (
            <View style={styles.magBox}>
              <Text style={{ color: '#FFFFFF', fontFamily: F.label, fontSize: 16 * s, lineHeight: 23 * s }}>{story.why_it_matters}</Text>
            </View>
          )}
          <Actions color="#FFFFFF" muted="#9A9A9A" saved={saved} onSave={onSave} onShare={onShare} onReport={onReport} onChain={onChain} onOpen={onOpen} s={s} pill />
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
  const body = { color: INK, fontFamily: FS.serif, fontSize: 16 * s, lineHeight: lh, textAlign: 'justify' as const };
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
      <Text style={{ fontFamily: F.medium, fontSize: 11 * s, color: '#4A453A', marginTop: 4 }} numberOfLines={1}>
        {showImage ? (aiPicture(story) ? 'Illustration' : 'Picture') + ' · ' : ''}Reported by {story.source}
      </Text>

      <Pressable style={{ flex: 1, overflow: 'hidden', marginTop: 10 }} onLayout={(e) => fit.onBox(e.nativeEvent.layout.height)} onPress={fit.cut ? onReadMore : undefined} disabled={!fit.cut}>
        <Text style={[body, { position: 'absolute', left: 0, right: 0, opacity: 0 }]} onLayout={(e) => fit.onFull(e.nativeEvent.layout.height)} accessible={false} android_hyphenationFrequency="normal">
          {story.technical}
        </Text>
        <Text style={body} numberOfLines={fit.cut ? Math.max(1, fit.lines - 1) : fit.lines} ellipsizeMode="tail" android_hyphenationFrequency="normal">
          <Text style={{ fontFamily: FS.serifBold }}>{lead}</Text>
          {highlight(rest, story).map((pc, i) => (pc.mark ? <Text key={i} style={marks[pc.mark]}>{pc.text}</Text> : pc.text))}
        </Text>
        {fit.cut && <Text style={{ fontFamily: F.head, fontSize: 13 * s, color: RED, lineHeight: lh }}>Read more</Text>}
      </Pressable>

      {!!story.why_it_matters && (
        <View style={styles.paperWhy}>
          <Text style={{ fontFamily: F.label, fontSize: 14.5 * s, lineHeight: 21 * s, color: INK }} numberOfLines={3}>{story.why_it_matters}</Text>
        </View>
      )}
      <Actions color={INK} muted="#5C564A" saved={saved} onSave={onSave} onShare={onShare} onReport={onReport} onChain={onChain} onOpen={onOpen} s={s} />
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
  const body = { color: '#E9FFF0', fontFamily: FS.mono, fontSize: 14.5 * s, lineHeight: lh, textAlign: 'justify' as const };
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

        <Pressable onPress={onOpen} style={styles.termBox}>
          {!!label && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Text style={{ backgroundColor: '#FF4D4D', color: '#000', fontFamily: FS.monoBold, fontSize: 12.5 * s, paddingHorizontal: 7, paddingVertical: 1 }}>
                {label.toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={{ color: '#FFFFFF', fontFamily: FS.monoBold, fontSize: 19 * s, lineHeight: 26 * s }} numberOfLines={3}>{story.headline}</Text>
        </Pressable>

        <Text style={[mono(13), { marginTop: 16 }]}>&gt; cat summary.txt</Text>
        <Pressable style={{ flex: 1, overflow: 'hidden' }} onLayout={(e) => fit.onBox(e.nativeEvent.layout.height)} onPress={fit.cut ? onReadMore : undefined} disabled={!fit.cut}>
          <Text style={[body, { position: 'absolute', left: 0, right: 0, opacity: 0 }]} onLayout={(e) => fit.onFull(e.nativeEvent.layout.height)} accessible={false} android_hyphenationFrequency="normal">
            {story.technical}
          </Text>
          <Rich text={story.technical} story={story} base={body} marks={marks} lines={fit.cut ? Math.max(1, fit.lines - 1) : fit.lines} />
          {fit.cut && <Text style={[mono(13, GREEN), { lineHeight: lh }]}>&gt; less summary.txt</Text>}
        </Pressable>

        {!!story.why_it_matters && (
          <>
            <Text style={[mono(13), { marginTop: 10 }]}>&gt; ./takeaway</Text>
            <Text style={{ color: GREEN, fontFamily: FS.monoBold, fontSize: 14.5 * s, lineHeight: lh }} numberOfLines={3}>
              [!] {story.why_it_matters}
            </Text>
          </>
        )}
        {!!onChain && (
          <Pressable onPress={onChain} hitSlop={8} style={{ marginTop: 10, marginBottom: 6 }} accessibilityLabel="Show attack chain">
            <Text style={mono(13, GREEN)}>
              &gt; open attack_chain <Text style={{ backgroundColor: GREEN, color: GREEN }}> </Text>
            </Text>
          </Pressable>
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
  termBar: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 44, paddingHorizontal: 18, backgroundColor: '#0E1912', borderTopWidth: 1, borderTopColor: '#1D2B23' },
});
