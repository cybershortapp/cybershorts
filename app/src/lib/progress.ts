import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * The reader's game progress: XP, rank, daily streak and badges. Kept only on the phone (no account).
 */
export type Progress = {
  xp: number;
  days: string[]; // dates (YYYY-MM-DD, local) with at least one game played, newest first
  badges: Record<string, string>; // badge id -> date earned
  played: Record<string, { plays: number; wins: number; best: number }>;
  done?: string[]; // games finished from the Play section (by game id), newest first
};
export type Result = { game: string; won: boolean; xp: number; badge?: string };

const KEY = 'progress-v1';
const EMPTY: Progress = { xp: 0, days: [], badges: {}, played: {} };
let state: Progress = EMPTY;
const listeners = new Set<() => void>();

let ready = false;
AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) state = { ...EMPTY, ...JSON.parse(raw) };
  })
  .catch(() => {})
  .finally(() => {
    ready = true;
    listeners.forEach((l) => l());
  });
/** The saved progress has been read (before that, XP shows 0 and a jump to the saved XP isn't a win). */
export const progressReady = () => ready;

const save = () => {
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  listeners.forEach((l) => l());
};
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const RANKS = [
  { name: 'Rookie', from: 0 },
  { name: 'Analyst', from: 300 },
  { name: 'Defender', from: 1000 },
  { name: 'Hunter', from: 2500 },
  { name: 'Legend', from: 5000 },
];
export function rankOf(xp: number) {
  let k = 0;
  RANKS.forEach((r, i) => {
    if (xp >= r.from) k = i;
  });
  const next = RANKS[k + 1];
  return { name: RANKS[k].name, index: k, next: next?.name ?? null, toNext: next ? next.from - xp : 0, progress: next ? (xp - RANKS[k].from) / (next.from - RANKS[k].from) : 1 };
}
export const levelOf = (xp: number) => Math.floor(xp / 250) + 1;

export function streakOf(p: Progress) {
  const set = new Set(p.days);
  const d = new Date();
  if (!set.has(day(d))) d.setDate(d.getDate() - 1); // yesterday still counts until today ends
  let n = 0;
  while (set.has(day(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const BADGES: Record<string, { name: string; icon: string }> = {
  defender: { name: 'Chain Breaker', icon: '🛡' },
  hot_seat: { name: 'Help Desk Hero', icon: '🎧' },
  approve: { name: 'Prompt Proof', icon: '📵' },
  home: { name: 'Digital Fortress', icon: '🏰' },
  overshare: { name: 'Overshare Detective', icon: '🕵️' },
  scam_or_legit: { name: 'Scam Spotter', icon: '🔍' },
  patch_or_panic: { name: 'Bomb Defuser', icon: '💣' },
  red_flags: { name: 'Red Flag Finder', icon: '🚩' },
  real_link: { name: 'Link Checker', icon: '🔗' },
  order_steps: { name: 'Breach-Proof', icon: '🧱' },
  crack_meter: { name: 'Uncrackable', icon: '🔐' },
  streak7: { name: 'Week Streak', icon: '🔥' },
};

/** Record a finished game. Returns what changed, for the "+XP" moment. */
export function recordResult(r: Result) {
  const before = rankOf(state.xp);
  const today = day();
  const days = state.days[0] === today ? state.days : [today, ...state.days].slice(0, 90);
  const prev = state.played[r.game] ?? { plays: 0, wins: 0, best: 0 };
  const badges = { ...state.badges };
  let newBadge: string | null = null;
  if (r.won && r.badge && BADGES[r.badge] && !badges[r.badge]) {
    badges[r.badge] = today;
    newBadge = r.badge;
  }
  state = {
    ...state,
    xp: state.xp + Math.max(0, Math.round(r.xp)),
    days,
    badges,
    played: { ...state.played, [r.game]: { plays: prev.plays + 1, wins: prev.wins + (r.won ? 1 : 0), best: Math.max(prev.best, r.xp) } },
  };
  if (streakOf(state) >= 7 && !state.badges.streak7) state.badges = { ...state.badges, streak7: today };
  save();
  const after = rankOf(state.xp);
  return { xp: Math.round(r.xp), newBadge, rankUp: after.index > before.index ? after.name : null };
}

/** A game from the Play section was finished: show a tick next to it. */
export function markDone(id: string) {
  const done = state.done ?? [];
  if (done.includes(id)) return;
  state = { ...state, done: [id, ...done].slice(0, 300) };
  save();
}
export const totalPlays = (p: Progress) => Object.values(p.played).reduce((n, x) => n + x.plays, 0);

export function getProgress() {
  return state;
}
export function useProgress(): Progress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
