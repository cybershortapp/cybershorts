import { useMemo, useState } from 'react';
import { Text, type TextStyle, View, type ViewStyle } from 'react-native';

/** A line is stretched to both edges only if its words already fill this much of the width. */
const FULL_ENOUGH = 0.86;

/** A run of text with its own look (bold, colour). */
export type Piece = { text: string; style?: TextStyle };
type Word = Piece[];

/** Splits styled pieces into words (a word can mix looks, e.g. a bold CVE ID followed by a plain comma). */
function toWords(pieces: Piece[]): Word[] {
  const words: Word[] = [];
  let cur: Word = [];
  for (const p of pieces) {
    for (const part of p.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (cur.length) words.push(cur);
        cur = [];
      } else {
        cur.push({ text: part, style: p.style });
      }
    }
  }
  if (cur.length) words.push(cur);
  return words;
}

/**
 * Text with straight left and right edges, the same on Android and iPhone.
 * The text is laid out once invisibly to find where each line breaks; then every line except the
 * last of a paragraph spreads its words across the full width. Until that's measured (or if the
 * line breaks can't be matched to words), it shows as normal left-aligned text.
 */
export function Justified({ pieces, style, lines: maxLines, containerStyle }: {
  pieces: Piece[];
  style: TextStyle;
  lines?: number;
  containerStyle?: ViewStyle;
}) {
  const [lineTexts, setLineTexts] = useState<string[] | null>(null);
  const [lineWidths, setLineWidths] = useState<number[]>([]);
  const [boxWidth, setBoxWidth] = useState(0);
  const full = pieces.map((p) => p.text).join('');
  const words = useMemo(() => toWords(pieces), [pieces]);

  const rows = useMemo(() => {
    if (!lineTexts) return null;
    const out: { words: Word[]; spread: boolean }[] = [];
    let w = 0;
    for (let i = 0; i < lineTexts.length; i++) {
      const t = lineTexts[i];
      const n = t.trim() ? t.trim().split(/\s+/).length : 0;
      const lineWords = words.slice(w, w + n);
      w += n;
      const endsParagraph = i === lineTexts.length - 1 || /\n\s*$/.test(t);
      // only stretch a line that's already nearly full; a short line (a few long CVE numbers, say)
      // would get big ugly gaps, so it stays normal, the way books and newspapers do it
      const full = boxWidth > 0 && (lineWidths[i] ?? 0) >= boxWidth * FULL_ENOUGH;
      out.push({ words: lineWords, spread: !endsParagraph && lineWords.length > 1 && full });
    }
    // a word split across two lines (a very long link) would throw the count off: fall back to plain text
    return w === words.length ? out : null;
  }, [lineTexts, lineWidths, boxWidth, words]);

  const shown = rows && maxLines ? rows.slice(0, maxLines) : rows;
  const render = (word: Word, k: number) => (
    <Text key={k} style={style}>
      {word.map((seg, j) => (seg.style ? <Text key={j} style={seg.style}>{seg.text}</Text> : seg.text))}
    </Text>
  );

  return (
    <View style={containerStyle} accessible accessibilityLabel={full} onLayout={(e) => setBoxWidth(Math.round(e.nativeEvent.layout.width))}>
      {/* invisible copy, only to learn where the lines break */}
      <Text
        style={[style, { position: 'absolute', left: 0, right: 0, opacity: 0 }]}
        onTextLayout={(e) => {
          const next = e.nativeEvent.lines.map((l) => l.text);
          const widths = e.nativeEvent.lines.map((l) => Math.round(l.width));
          setLineTexts((prev) => (prev && prev.length === next.length && prev.every((x, i) => x === next[i]) ? prev : next));
          setLineWidths((prev) => (prev.length === widths.length && prev.every((x, i) => x === widths[i]) ? prev : widths));
        }}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        {pieces.map((p, i) => (p.style ? <Text key={i} style={p.style}>{p.text}</Text> : p.text))}
      </Text>

      {shown ? (
        shown.map((row, i) =>
          row.spread ? (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {row.words.map(render)}
            </View>
          ) : (
            <Text key={i} style={style}>
              {row.words.map((word, k) => (
                <Text key={k}>
                  {k > 0 ? ' ' : ''}
                  {word.map((seg, j) => (seg.style ? <Text key={j} style={seg.style}>{seg.text}</Text> : seg.text))}
                </Text>
              ))}
            </Text>
          ),
        )
      ) : (
        <Text style={style} numberOfLines={maxLines}>
          {pieces.map((p, i) => (p.style ? <Text key={i} style={p.style}>{p.text}</Text> : p.text))}
        </Text>
      )}
    </View>
  );
}
