import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

export type GameStyle = 'scam_or_legit' | 'patch_or_panic' | 'red_flags' | 'real_link' | 'order_steps' | 'crack_meter';
export type Game = { id: string; story_id: string; style: GameStyle; data: any };
export type DeckSlide = { kicker: string; title: string; text: string; points: string[]; image: string | null };
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
    return (data as Game[]).filter((g) => g && g.id && g.story_id && g.style && g.data);
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

export function markDeckSeen(id: string) {
  if (seenDecks.has(id)) return;
  seenDecks.add(id);
  AsyncStorage.setItem(SEEN_DECKS, JSON.stringify([...seenDecks].slice(-100))).catch(() => {});
}
