import type { ChainStep, DefendMove, Explainer, Incident, Story, ThreatGroup } from './types';

// Stories are written by different AI models, so a field can occasionally be missing or the wrong shape.
// Everything is tidied here once, so a single odd story can never crash a screen.
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []) as string[];
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function cleanStep(v: unknown): ChainStep | null {
  const o = obj(v);
  const stage = str(o?.stage ?? o?.tactic).trim();
  const detail = str(o?.detail ?? o?.description).trim();
  if (!o || !stage || !detail) return null;
  return {
    stage,
    tactic: str(o.tactic || stage),
    detail,
    technique: o.technique ? str(o.technique) : undefined,
    source: o.source ? str(o.source) : undefined,
    source_url: typeof o.source_url === 'string' && o.source_url.startsWith('http') ? o.source_url : undefined,
  };
}

// a capital to start each sentence (older explainers sometimes came all lowercase); iPhone and eBay stay as they are
const cap = (v: unknown) => {
  const t = str(v).trim();
  return /^[a-z](?![A-Z])/.test(t) ? t[0].toUpperCase() + t.slice(1) : t;
};

/**
 * Names the AI wrote in lower case ("github", "gheist") get their capitals back, taken from the story's own
 * summary: a word written with capitals there (GitHub, Gheist, Microsoft) and never in lower case. Words that are
 * only capitalised because they start a sentence don't count, so "the" or "attackers" are never touched.
 */
function namesFrom(source: string, trusted: string[] = []): Map<string, string> {
  const names = new Map<string, string>();
  const seen = new Map<string, number>(); // capitalised mid-sentence, how often
  const lower = new Set<string>();
  const re = /[A-Za-z][A-Za-z0-9]*(?:[.'+-][A-Za-z0-9]+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const w = m[0];
    if (w.length < 3) continue;
    if (w === w.toLowerCase()) {
      lower.add(w);
      continue;
    }
    const before = source.slice(Math.max(0, m.index - 3), m.index);
    const startsSentence = m.index === 0 || /[.!?:]\s*$|^\s*$/.test(before) || /\n\s*$/.test(before);
    // GitHub, iOS, API: capitals inside the word always mean a name
    if (/[A-Z]/.test(w.slice(1))) names.set(w.toLowerCase(), w);
    else if (!startsSentence) seen.set(w, (seen.get(w) ?? 0) + 1);
  }
  // a plain capitalised word counts when it's written that way at least twice ("Wiz Research" once isn't enough)
  seen.forEach((n, w) => n >= 2 && names.set(w.toLowerCase(), w));
  // the attacker, victim and group names are names for sure
  trusted.forEach((t) => (t.match(re) ?? []).forEach((w) => w.length >= 3 && w !== w.toLowerCase() && names.set(w.toLowerCase(), w)));
  lower.forEach((w) => names.delete(w));
  return names;
}
function withNames(text: string, names: Map<string, string>) {
  if (!names.size || !text) return text;
  return text.replace(/[A-Za-z][A-Za-z0-9]*(?:[.'+-][A-Za-z0-9]+)*/g, (w) => (w === w.toLowerCase() && names.has(w) ? names.get(w)! : w));
}

/** The chain page's extra words. Anything odd is dropped, so the page falls back to plain wording. */
function cleanExplainer(v: unknown, steps: number, source = '', trusted: string[] = []): Explainer | undefined {
  const ex = cleanExplainerShape(v, steps);
  if (!ex) return ex;
  const names = namesFrom(source, trusted);
  const fix = (t: string) => withNames(t, names);
  return {
    ...ex,
    title: fix(ex.title),
    lesson: fix(ex.lesson),
    impact: ex.impact.map((x) => ({ value: x.value, label: fix(x.label) })),
    steps: ex.steps.map((x) => ({ title: fix(x.title), stop: fix(x.stop) })),
    defend: ex.defend.map((d) => ({ ...d, situation: fix(d.situation), options: d.options.map(fix), good: fix(d.good), bad: d.bad.map(fix) })),
    checks: ex.checks.map(fix),
  };
}

function cleanExplainerShape(v: unknown, steps: number): Explainer | undefined {
  const o = obj(v);
  if (!o || o.failed || !str(o.title)) return undefined;
  const st = Array.isArray(o.steps) ? o.steps.map(obj) : [];
  if (st.length !== steps || st.some((s) => !s || !str(s.title) || !str(s.stop))) return undefined;
  const defend: DefendMove[] = (Array.isArray(o.defend) ? o.defend : [])
    .map(obj)
    .filter((d): d is Record<string, unknown> => !!d)
    .map((d) => ({ step: Number(d.step), situation: cap(d.situation), options: strList(d.options).map(cap), answer: Number(d.answer), good: cap(d.good), bad: Array.isArray(d.bad) ? d.bad.map(cap) : [] }))
    .filter((d) => Number.isInteger(d.step) && d.step >= 0 && d.step < steps && d.options.length === 3 && d.answer >= 0 && d.answer < 3 && d.situation && d.good && d.bad.length === 3)
    .slice(0, 3);
  return {
    title: cap(o.title),
    impact: (Array.isArray(o.impact) ? o.impact : []).map(obj).filter((x): x is Record<string, unknown> => !!x && !!str(x.value) && !!str(x.label)).slice(0, 2).map((x) => ({ value: str(x.value), label: cap(x.label) })),
    lesson: cap(o.lesson),
    steps: st.map((s) => ({ title: cap(s!.title), stop: cap(s!.stop) })),
    defend,
    checks: strList(o.checks).slice(0, 3).map(cap),
  };
}

export function cleanStory(raw: Story): Story {
  const r = raw as unknown as Record<string, unknown>;
  const chain = Array.isArray(r.attack_chain) ? r.attack_chain.map(cleanStep).filter((x): x is ChainStep => !!x) : [];
  const inc = obj(r.incident);
  const incident: Incident | null = inc
    ? {
        victim: inc.victim ? str(inc.victim) : undefined,
        victim_country: inc.victim_country ? str(inc.victim_country) : undefined,
        actor: inc.actor ? str(inc.actor) : undefined,
        actor_country: inc.actor_country ? str(inc.actor_country) : undefined,
        attributed_by: inc.attributed_by ? str(inc.attributed_by) : undefined,
        researched: !!inc.researched,
        sources: strList(inc.sources),
        // the summary (not the headline, which is often In Title Case) says how names are written
        explainer: cleanExplainer(
          inc.explainer,
          chain.length,
          [str(r.technical), str(r.why_it_matters), chain.map((c) => c.detail).join(' ')].join('\n'),
          [str(inc.victim), str(inc.actor), str(r.actor_group)],
        ),
      }
    : null;
  const also = Array.isArray(r.also_reported)
    ? r.also_reported.map(obj).filter((x): x is Record<string, unknown> => !!x && typeof x.url === 'string').map((x) => ({ source: str(x.source), url: str(x.url) }))
    : [];
  return {
    ...raw,
    headline: str(r.headline) || 'Untitled story',
    technical: str(r.technical),
    why_it_matters: r.why_it_matters ? str(r.why_it_matters) : null,
    source: str(r.source),
    url: str(r.url),
    category: str(r.category) || 'Other',
    cves: strList(r.cves),
    products: strList(r.products),
    attack_chain: chain.length ? chain : null,
    also_reported: also,
    incident,
    image_url: typeof r.image_url === 'string' && r.image_url.startsWith('http') ? r.image_url : null,
    published_at: str(r.published_at) || str(r.created_at),
  };
}

export const cleanStories = (rows: Story[] | null | undefined) => (rows ?? []).filter((x) => x && x.id).map(cleanStory);

export function cleanGroup(raw: ThreatGroup | null): ThreatGroup | null {
  if (!raw || !raw.name) return null;
  return {
    ...raw,
    aliases: strList(raw.aliases),
    methods: strList(raw.methods),
    campaigns: strList(raw.campaigns),
    summary: raw.summary ? str(raw.summary) : null,
    url: typeof raw.url === 'string' ? raw.url : '',
  };
}
