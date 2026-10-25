import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

export const GAME_STYLES = ['scam_or_legit', 'patch_or_panic', 'red_flags', 'real_link', 'order_steps', 'crack_meter', 'hot_seat', 'approve', 'home', 'overshare'] as const;
export type GameStyle = (typeof GAME_STYLES)[number];
// a style this app version can't draw yet (sent by a newer server) is simply left out
const knownStyle = (s: unknown) => (GAME_STYLES as readonly unknown[]).includes(s);
export type Game = { id: string; story_id: string; style: GameStyle; data: any };
export type DeckSlide = {
  kicker: string; title: string; text: string; points: string[]; image: string | null;
  /** extras for the deck looks: the look itself (on the first slide), a time label (Timeline), two speech bubbles (Comic) */
  style?: string; when?: string; say?: string[];
};
export type Deck = { id: string; topic: string; title: string; slides: DeckSlide[]; story_ids: string[]; country: string };

const SEEN_GAMES = 'games-seen';
const GAMES_DAY = 'games-day';
const SEEN_DECKS = 'decks-seen';
export const GAMES_PER_DAY = 3;
export const GAME_GAP = 8; // at most one game every 8 cards

/** Games written for these stories (the ones that have one). Never throws: no games is fine. */
export async function fetchGames(storyIds: string[]): Promise<Game[]> {
  if (!storyIds.length) return [];
  try {
    const { data, error } = await supabase.from('games').select('id,story_id,style,data').in('story_id', storyIds.slice(0, 200));
    if (error || !Array.isArray(data)) return [];
    return (data as Game[]).filter((g) => g && g.id && g.story_id && knownStyle(g.style) && g.data);
  } catch {
    return [];
  }
}

/** The newest trending deck for these countries that hasn't expired, or null. */
export async function fetchDeck(countries: string[]): Promise<Deck | null> {
  try {
    const { data, error } = await supabase
      .from('decks')
      .select('id,topic,title,slides,story_ids,country')
      .gt('expires_at', new Date().toISOString())
      .in('country', countries)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    const d = data[0] as Deck;
    return Array.isArray(d.slides) && d.slides.length >= 3 ? d : null;
  } catch {
    return null;
  }
}

// ---- what this phone has already seen (kept only on the phone) ----
let seenGames = new Set<string>();
let seenDecks = new Set<string>();
let today = { date: '', count: 0 };
const dayKey = () => new Date().toISOString().slice(0, 10);

export const extrasReady = Promise.all([
  AsyncStorage.getItem(SEEN_GAMES).then((v) => { if (v) seenGames = new Set(JSON.parse(v)); }),
  AsyncStorage.getItem(SEEN_DECKS).then((v) => { if (v) seenDecks = new Set(JSON.parse(v)); }),
  AsyncStorage.getItem(GAMES_DAY).then((v) => { if (v) today = JSON.parse(v); }),
]).catch(() => {});

export const gameSeen = (id: string) => seenGames.has(id);
export const deckSeen = (id: string) => seenDecks.has(id);
export function gamesLeftToday() {
  return today.date === dayKey() ? Math.max(0, GAMES_PER_DAY - today.count) : GAMES_PER_DAY;
}

export function markGameSeen(id: string) {
  if (seenGames.has(id)) return;
  seenGames.add(id);
  const d = dayKey();
  today = today.date === d ? { date: d, count: today.count + 1 } : { date: d, count: 1 };
  AsyncStorage.setItem(SEEN_GAMES, JSON.stringify([...seenGames].slice(-500))).catch(() => {});
  AsyncStorage.setItem(GAMES_DAY, JSON.stringify(today)).catch(() => {});
}

/** Played from the Play section: the feed won't show it again, and it doesn't use up today's feed games. */
export function markGamePlayed(id: string) {
  if (seenGames.has(id)) return;
  seenGames.add(id);
  AsyncStorage.setItem(SEEN_GAMES, JSON.stringify([...seenGames].slice(-500))).catch(() => {});
}

export function markDeckSeen(id: string) {
  if (seenDecks.has(id)) return;
  seenDecks.add(id);
  AsyncStorage.setItem(SEEN_DECKS, JSON.stringify([...seenDecks].slice(-100))).catch(() => {});
}

// ---- release 1.0.4 (second pass): games for everyone, tip and history at the right time ----

/** Recent games for this region, newest first, each with the headline of the story it's about. */
export type PoolGame = Game & { headline: string };
export async function fetchGamePool(countries: string[]): Promise<PoolGame[]> {
  try {
    const since = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from('games')
      .select('id,story_id,style,data,created_at,stories!inner(headline,country)')
      .gte('created_at', since)
      .in('stories.country', countries)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error || !Array.isArray(data)) return [];
    return (data as any[])
      .filter((g) => g && g.id && knownStyle(g.style) && g.data && g.stories)
      .map((g) => ({ id: g.id, story_id: g.story_id, style: g.style, data: g.data, headline: g.stories.headline ?? '' }));
  } catch {
    return [];
  }
}

// Games a day: at least 3 for everyone; readers who read a lot get one more for every 20 cards, up to 6.
const CARDS_DAY = 'cards-day';
let cardsToday = { date: '', count: 0 };
const cardsReady = AsyncStorage.getItem(CARDS_DAY).then((v) => { if (v) cardsToday = JSON.parse(v); }).catch(() => {});
export const extrasAllReady = Promise.all([extrasReady, cardsReady]);
export function markCardRead() {
  const d = dayKey();
  cardsToday = cardsToday.date === d ? { date: d, count: cardsToday.count + 1 } : { date: d, count: 1 };
  if (cardsToday.count % 5 === 0) AsyncStorage.setItem(CARDS_DAY, JSON.stringify(cardsToday)).catch(() => {});
}
export function gamesQuotaToday() {
  const read = cardsToday.date === dayKey() ? cardsToday.count : 0;
  return Math.min(6, 3 + Math.floor(read / 20));
}
export function gamesPlayedToday() {
  return today.date === dayKey() ? today.count : 0;
}

/** Today's tip and today's history card for this region (made at 9am), if they exist yet. */
export async function fetchDailyCards(countries: string[], fields: string) {
  try {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from('stories')
      .select(fields)
      .in('source', ['CyberSid Tips', 'CyberSid History'])
      .in('country', countries)
      .gte('created_at', midnight.toISOString())
      .order('created_at', { ascending: false })
      .limit(6);
    if (error || !Array.isArray(data)) return { tip: null, history: null };
    const rows = data as any[];
    return { tip: rows.find((r) => r.source === 'CyberSid Tips') ?? null, history: rows.find((r) => r.source === 'CyberSid History') ?? null };
  } catch {
    return { tip: null, history: null };
  }
}

// a tip or history card is put near the top until it has been read once today
const PINNED = 'pinned-read';
let pinnedRead = { date: '', ids: [] as string[] };
AsyncStorage.getItem(PINNED).then((v) => { if (v) pinnedRead = JSON.parse(v); }).catch(() => {});
export const pinnedSeen = (id: string) => pinnedRead.date === dayKey() && pinnedRead.ids.includes(id);
export function markPinnedSeen(id: string) {
  const d = dayKey();
  if (pinnedSeen(id)) return;
  pinnedRead = pinnedRead.date === d ? { date: d, ids: [...pinnedRead.ids, id] } : { date: d, ids: [id] };
  AsyncStorage.setItem(PINNED, JSON.stringify(pinnedRead)).catch(() => {});
}
