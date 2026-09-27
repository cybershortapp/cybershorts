import type { Story } from './types';
import { severityOf } from '../theme';

export const LEVELS = ['Low', 'Guarded', 'Elevated', 'High'] as const;
export type Level = (typeof LEVELS)[number];

export type Brief = {
  level: Level;
  levelIndex: number; // 1 to 4
  critical: number;
  high: number;
  todayCount: number;
  top: Story[];
};

const DAY = 24 * 60 * 60 * 1000;

/** Works out today's threat level and top stories from the latest stories. */
export function buildBrief(stories: Story[]): Brief {
  const now = Date.now();
  const today = stories.filter((s) => now - new Date(s.published_at).getTime() < DAY);
  const critical = today.filter((s) => s.severity === 'Critical').length;
  const high = today.filter((s) => s.severity === 'High').length;

  const levelIndex = critical >= 3 ? 4 : critical >= 1 ? 3 : high >= 3 ? 2 : 1;

  // most serious first, then newest; use the last 3 days if today is quiet
  const pool = today.length >= 3 ? today : stories.filter((s) => now - new Date(s.published_at).getTime() < 3 * DAY);
  const top = [...pool]
    .sort(
      (a, b) =>
        severityOf(b.severity).rank - severityOf(a.severity).rank ||
        new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    )
    .slice(0, 3);

  return { level: LEVELS[levelIndex - 1], levelIndex, critical, high, todayCount: today.length, top };
}
