import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import type { Severity } from './lib/types';

type Sev = { bg: string; fg: string; accent: string; rank: number };

/** CyberSid colours, taken from the logo (cyan > blue > purple). Muted, so it reads premium, not loud. */
const LIGHT = {
  dark: false,
  bg: '#F5F7FC',
  card: '#F4F7FF',
  surface: '#FFFFFF',
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
  bg: '#0A0E17',
  card: '#111827',
  surface: '#161E2E',
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

/** Logo-style fonts (Poppins). Body text stays on the system font for easy reading. */
export const F = {
  brand: 'Poppins_700Bold',
  head: 'Poppins_600SemiBold',
  label: 'Poppins_600SemiBold',
  medium: 'Poppins_500Medium',
};

// ---- the reader's theme choice: follow the phone, or always light / dark ----
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'theme-choice';
let choice: ThemeChoice = 'system';
const listeners = new Set<() => void>();
AsyncStorage.getItem(KEY)
  .then((v) => {
    if (v === 'light' || v === 'dark' || v === 'system') {
      choice = v;
      listeners.forEach((l) => l());
    }
  })
  .catch(() => {});

export function setThemeChoice(c: ThemeChoice) {
  choice = c;
  AsyncStorage.setItem(KEY, c).catch(() => {});
  listeners.forEach((l) => l());
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice,
  );
}

/** The colours to draw with right now. */
export function useTheme(): Palette {
  const system = useColorScheme() ?? Appearance.getColorScheme() ?? 'light';
  const c = useThemeChoice();
  const dark = c === 'dark' || (c === 'system' && system === 'dark');
  return dark ? DARK : LIGHT;
}

export function severityOf(s: Severity | null | undefined, C: Palette = LIGHT) {
  return C.sev[s ?? 'Info'] ?? C.sev.Info;
}
