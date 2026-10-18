import type { Story } from './types';

/** Kinds of words that stand out in the card styles. */
export type Mark = 'cve' | 'number' | 'product' | 'danger' | null;
export type Piece = { text: string; mark: Mark };

const DANGER = [
  'without (?:logging in|authentication|a password|user interaction)',
  'actively exploited',
  'exploited in the wild',
  'in the wild',
  'zero-day',
  'remote code execution',
  'ransomware',
  'stolen',
  'leaked',
];
const NUMBER = String.raw`(?<![\w\-‐‑–.])\d+(?:[.,]\d+)*(?:\s?(?:out of 10|million|billion|thousand|records|customers|users|patients|accounts|devices|servers|%))?\b`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split a summary into pieces, marking the facts that matter: CVE IDs, numbers (scores, records, money),
 * the products the story is about, and danger phrases. Done on the phone from text we already have.
 */
export function highlight(text: string, story: Pick<Story, 'products'>): Piece[] {
  const products = (story.products ?? []).filter((p) => p.length > 2).sort((a, b) => b.length - a.length).slice(0, 8);
  const parts = [
    String.raw`(CVE[-‐‑–]\d{4}[-‐‑–]\d{4,7})`,
    products.length ? `(${products.map(esc).join('|')})` : '(?!x)(x)',
    `(${DANGER.join('|')})`,
    `(${NUMBER})`,
  ];
  let re: RegExp;
  try {
    re = new RegExp(parts.join('|'), 'gi');
  } catch {
    // a phone whose JavaScript engine lacks look-behind: same rules, numbers matched more loosely
    re = new RegExp(parts.join('|').replace(NUMBER, NUMBER.replace(/^\(\?<!\[[^\]]*\]\)/, '\\b')), 'gi');
  }
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    const word = m[0];
    // plain years and tiny numbers are not facts worth marking
    if (m[4] && (/^(19|20)\d{2}$/.test(word) || /^\d$/.test(word))) continue;
    if (i > last) out.push({ text: text.slice(last, i), mark: null });
    out.push({ text: word, mark: m[1] ? 'cve' : m[2] ? 'product' : m[3] ? 'danger' : 'number' });
    last = i + word.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: null });
  return out;
}
