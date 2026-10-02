import type { ChainStep, Incident, Story, ThreatGroup } from './types';

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
