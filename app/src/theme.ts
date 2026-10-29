import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import type { Severity } from './lib/types';

type Sev = { bg: string; fg: string; accent: string; rank: number };

/** CyberSid colours, taken from the logo (cyan > blue > purple). Muted, so it reads premium, not loud. */
const LIGHT = {
  dark: false,
  /** which theme this is, and whether it's one of the colourful glass themes (Vivid, Aurora) */
  mode: 'light' as ThemeChoice,
  glass: false,
  bg: '#F5F7FC',
  card: '#F4F7FF',
  surface: '#FFFFFF',
  sheet: '#FFFFFF', // pop-up sheets: always solid
  imageBg: '#E4ECFF',
  border: '#DCE3F2',
  borderSoft: '#C6D5F6',
  chipBorder: '#D6DCE8',
  text: '#0A0F1F',
  body: '#3A4256',
  muted: '#6B7389',
  brand: '#2563F5',
  brandDark: '#1F55D8',
  brandText: '#1945B0',
  onBrand: '#FFFFFF',
  purple: '#6A3FE0',
  danger: '#B42318',
  zeroBg: '#FDECEC',
  zeroBorder: '#F3C1C0',
  zeroText: '#B42318',
  pattern: 'light' as 'light' | 'dark',
  sev: {
    Critical: { bg: '#B42318', fg: '#FFFFFF', accent: '#B42318', rank: 4 },
    High: { bg: '#FAEEDA', fg: '#854F0B', accent: '#B45309', rank: 3 },
    Medium: { bg: '#EEE8FF', fg: '#5B32C8', accent: '#6A3FE0', rank: 2 },
    Info: { bg: '#EEF1F6', fg: '#565D6E', accent: '#6B7389', rank: 1 },
  } as Record<Severity, Sev>,
};

const DARK: typeof LIGHT = {
  dark: true,
  mode: 'dark',
  glass: false,
  bg: '#0A0E17',
  card: '#111827',
  surface: '#161E2E',
  sheet: '#161E2E',
  imageBg: '#1A2336',
  border: '#232E45',
  borderSoft: '#2D3B59',
  chipBorder: '#2A3550',
  text: '#ECEFF6',
  body: '#BAC3D4',
  muted: '#8B96AD',
  brand: '#4F7DFF',
  brandDark: '#7EA0FF',
  brandText: '#A8C0FF',
  onBrand: '#FFFFFF',
  purple: '#A38BFF',
  danger: '#FF8A80',
  zeroBg: '#3A1A1C',
  zeroBorder: '#6B2A2E',
  zeroText: '#FF9C94',
  pattern: 'dark',
  sev: {
    Critical: { bg: '#B42318', fg: '#FFFFFF', accent: '#FF8A80', rank: 4 },
    High: { bg: '#3A2A12', fg: '#F5C27A', accent: '#F5B75F', rank: 3 },
    Medium: { bg: '#2A2248', fg: '#C9BBFF', accent: '#B5A2FF', rank: 2 },
    Info: { bg: '#1F2737', fg: '#AEB8CA', accent: '#8B96AD', rank: 1 },
  },
};

export type Palette = typeof LIGHT;
/** Fixed light and dark palettes, for screens that must ignore the chosen theme (the attack chain inside a card style). */
export const LIGHT_PALETTE = LIGHT;
export const DARK_PALETTE = DARK;

/** One calm accent per tab, so each section has its own identity. [light, dark] */
export const TAB_COLOURS: Record<string, [string, string]> = {
  'For you': ['#2563F5', '#6F95FF'],
  All: ['#334155', '#A7B3C8'],
  Critical: ['#B42318', '#FF8A80'],
  'Zero-day': ['#C2410C', '#FF9F66'],
  Breaches: ['#6B46C1', '#B39DFF'],
  Scams: ['#A16207', '#E8B64C'],
  Vulnerabilities: ['#0F766E', '#4FD1C5'],
  Ransomware: ['#9D174D', '#F58BB5'],
  Tools: ['#4D7C0F', '#A3D65C'],
  Policy: ['#1E3A8A', '#8FA8F0'],
  Saved: ['#0369A1', '#6EC3F0'],
  Other: ['#475569', '#A7B3C8'],
  Tips: ['#0E7490', '#5FCDE4'],
  History: ['#92400E', '#F2B87A'],
};

export function tabColour(name: string, C: Palette) {
  const pair = TAB_COLOURS[name] ?? TAB_COLOURS.Other;
  return C.dark ? pair[1] : pair[0];
}

/** Glass themes: white text on colour, with see-through white panels like frosted glass. */
const GLASS = {
  ...DARK,
  glass: true,
  bg: '#141826',
  card: 'transparent',
  surface: 'rgba(255,255,255,0.13)',
  sheet: '#1A1F2E',
  imageBg: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.16)',
  borderSoft: 'rgba(255,255,255,0.24)',
  chipBorder: 'rgba(255,255,255,0.22)',
  text: '#FFFFFF',
  body: 'rgba(255,255,255,0.84)',
  muted: 'rgba(255,255,255,0.55)',
  brand: '#FFFFFF',
  brandDark: '#FFFFFF',
  brandText: '#FFFFFF',
  onBrand: '#000000',
  zeroBg: 'rgba(255,255,255,0.13)',
  zeroBorder: 'rgba(255,255,255,0.22)',
  zeroText: '#FFFFFF',
};
/** Vivid: every story takes the colour of its own picture. */
const VIVID: typeof LIGHT = { ...GLASS, mode: 'vivid' };
/** Aurora: CyberSid's logo colours glowing behind glass, the same on every story. */
const AURORA: typeof LIGHT = { ...GLASS, mode: 'aurora', bg: '#0A0F2C' };

/** Inter: a clean, modern font (the closest free match to Apple's). */
export const F = {
  brand: 'Inter_800ExtraBold',
  head: 'Inter_700Bold',
  label: 'Inter_600SemiBold',
  medium: 'Inter_500Medium',
  body: 'Inter_400Regular',
};

// ---- the reader's theme: Light (default), Vivid, Aurora or Dark, or follow the phone's light/dark mode ----
export type ThemeChoice = 'vivid' | 'aurora' | 'light' | 'dark';
export const THEMES: ThemeChoice[] = ['vivid', 'aurora', 'light', 'dark'];
const KEY = 'theme-choice';
const FOLLOW_KEY = 'theme-follow-phone';
let choice: ThemeChoice = 'light';
let follow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
AsyncStorage.multiGet([KEY, FOLLOW_KEY])
  .then(([[, v], [, f]]) => {
    // anything else (older versions saved 'system'): everyone starts on Light
    if (v === 'vivid' || v === 'aurora' || v === 'light' || v === 'dark') choice = v;
    follow = f === '1';
    notify();
  })
  .catch(() => {});

export function setThemeChoice(c: ThemeChoice) {
  choice = c;
  follow = false;
  AsyncStorage.multiSet([[KEY, c], [FOLLOW_KEY, '0']]).catch(() => {});
  notify();
}

export function setFollowPhone(on: boolean) {
  follow = on;
  AsyncStorage.setItem(FOLLOW_KEY, on ? '1' : '0').catch(() => {});
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice);
}

export function useFollowPhone(): boolean {
  return useSyncExternalStore(subscribe, () => follow);
}

/** The colours to draw with right now. */
export function useTheme(): Palette {
  const system = useColorScheme() ?? Appearance.getColorScheme() ?? 'light';
  const c = useThemeChoice();
  const f = useFollowPhone();
  if (f) return system === 'dark' ? DARK : LIGHT;
  return c === 'vivid' ? VIVID : c === 'aurora' ? AURORA : c === 'dark' ? DARK : LIGHT;
}

// ---- Vivid: the colour of each story ----
function mix(hex: string, target: number, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * amount));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** The screen behind a Vivid card: a deeper shade of the card's own colour, so the card stands out. */
export const deepen = (hex: string) => mix(hex, 0, 0.45);

/** A deep, rich colour for a story: the main colour of its picture (worked out by the news pipeline),
 *  or, when there isn't one yet, a deep shade of its section colour. White text always reads well on it. */
export function storyTint(story: { tint?: string | null; category: string; id: string }) {
  if (story.tint && /^#[0-9a-f]{6}$/i.test(story.tint)) return story.tint;
  return mix(TAB_COLOURS[story.category]?.[0] ?? TAB_COLOURS.Other[0], 8, 0.72);
}

export function severityOf(s: Severity | null | undefined, C: Palette = LIGHT) {
  return C.sev[s ?? 'Info'] ?? C.sev.Info;
}

// ---- the reader's card style: Focus (default), Standard, Magazine, Newspaper, Terminal or Ronin ----
export type CardStyle = 'focus' | 'standard' | 'magazine' | 'newspaper' | 'terminal' | 'ronin';
export const CARD_STYLES: CardStyle[] = ['focus', 'standard', 'magazine', 'newspaper', 'terminal', 'ronin'];
const STYLE_KEY = 'card-style';
// Focus became the default in 1.0.6: readers still on the old default (Standard) move to it once.
// Anyone who picked another style keeps it, and anyone can go back to Standard in Preferences.
const FOCUS_MOVE_KEY = 'card-style-focus-moved';
let cardStyle: CardStyle = 'focus';
AsyncStorage.multiGet([STYLE_KEY, FOCUS_MOVE_KEY])
  .then(([[, v], [, moved]]) => {
    if (!moved) {
      AsyncStorage.setItem(FOCUS_MOVE_KEY, '1').catch(() => {});
      if (!v || v === 'standard') {
        if (v) AsyncStorage.setItem(STYLE_KEY, 'focus').catch(() => {});
        return;
      }
    }
    if (v && (CARD_STYLES as string[]).includes(v)) {
      cardStyle = v as CardStyle;
      notify();
    }
  })
  .catch(() => {});

export function setCardStyle(s: CardStyle) {
  cardStyle = s;
  AsyncStorage.setItem(STYLE_KEY, s).catch(() => {});
  notify();
}

export function useCardStyle(): CardStyle {
  return useSyncExternalStore(subscribe, () => cardStyle);
}

/** Fonts for the card styles (loaded with the app). */
export const FS = {
  serif: 'LibreBaskerville_400Regular',
  serifItalic: 'LibreBaskerville_400Regular_Italic',
  serifBold: 'LibreBaskerville_700Bold',
  display: 'PlayfairDisplay_900Black',
  masthead: 'UnifrakturMaguntia_400Regular',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_700Bold',
  ink: 'CormorantGaramond_700Bold', // Ronin headlines
  wanted: 'Rye_400Regular', // deck looks: Wanted poster, Case file, Comic
  typewriter: 'SpecialElite_400Regular',
  comic: 'Bangers_400Regular',
  comicBody: 'ComicNeue_700Bold',
};
