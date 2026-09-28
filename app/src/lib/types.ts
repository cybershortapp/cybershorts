export type Severity = 'Critical' | 'High' | 'Medium' | 'Info';
export type Action = 'patch' | 'check_breach' | 'report_scam' | 'none';

export type ChainStep = { stage: string; tactic: string; detail: string; technique?: string; source?: string; source_url?: string };

export type Incident = {
  victim?: string;
  victim_country?: string;
  actor?: string;
  actor_country?: string;
  attributed_by?: string;
  researched?: boolean;
  sources?: string[];
};

export type ThreatGroup = {
  id: string;
  name: string;
  aliases: string[];
  summary: string | null;
  methods: string[];
  campaigns: string[];
  url: string;
};

export type Story = {
  id: string;
  source: string;
  url: string;
  headline: string;
  technical: string;
  why_it_matters: string | null;
  severity: Severity | null;
  action: Action | null;
  cves: string[] | null;
  attack_chain: ChainStep[] | null;
  also_reported: { source: string; url: string }[] | null;
  incident: Incident | null;
  actor_group: string | null;
  category: string;
  image_url: string | null;
  published_at: string;
  created_at: string;
  products: string[] | null;
  zero_day: boolean | null;
};

export const FILTERS = ['For you', 'All', 'Critical', 'Zero-day', 'Breaches', 'Scams', 'Vulnerabilities', 'Ransomware', 'Tools', 'Policy', 'Saved'] as const;
export type Filter = (typeof FILTERS)[number];

export const STORY_FIELDS =
  'id,source,url,headline,technical,why_it_matters,severity,action,cves,attack_chain,also_reported,incident,actor_group,category,image_url,published_at,created_at,products,zero_day';

export const REPORT_REASONS = ['Wrong facts', 'Wrong severity', 'Broken link', 'Duplicate story', 'Not cyber news', 'Other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
