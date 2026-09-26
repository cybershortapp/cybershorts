export type Story = {
  id: string;
  source: string;
  url: string;
  headline: string;
  simple: string;
  technical: string;
  category: string;
  image_url: string | null;
  published_at: string;
};

export type Mode = 'simple' | 'technical';

export const CATEGORIES = ['All', 'Breaches', 'Scams', 'Vulnerabilities', 'Ransomware', 'Tools', 'Policy'] as const;
export type Category = (typeof CATEGORIES)[number];
