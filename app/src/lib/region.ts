import { I18nManager, NativeModules, Platform } from 'react-native';

import { getPrefs } from './prefs';

/**
 * Where the reader is, so they see local news, tips and report links:
 *   GB    United Kingdom
 *   IN    India
 *   INTL  anywhere else (news for everyone only)
 * Chosen in Preferences, or worked out from the phone's time zone and language settings.
 */
export type Region = 'GB' | 'IN' | 'INTL';

export const REGION_NAMES: Record<Region, string> = { GB: 'United Kingdom', IN: 'India', INTL: 'Worldwide' };

const TIME_ZONES: Record<string, Region> = {
  'Europe/London': 'GB', 'Europe/Belfast': 'GB', GB: 'GB',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN',
};

let detected: Region | null = null;

/** Best guess from the phone: its time zone, then the country in its language setting (e.g. en_IN). */
export function detectRegion(): Region {
  if (detected) return detected;
  let guess: Region = 'INTL';
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && TIME_ZONES[tz]) guess = TIME_ZONES[tz];
  } catch {}
  if (guess === 'INTL') {
    try {
      const locale: string =
        (I18nManager as unknown as { getConstants?: () => { localeIdentifier?: string } }).getConstants?.().localeIdentifier ??
        (Platform.OS === 'android' ? NativeModules.I18nManager?.localeIdentifier : '') ??
        '';
      const country = locale.split(/[_-]/)[1]?.toUpperCase();
      if (country === 'GB') guess = 'GB';
      else if (country === 'IN') guess = 'IN';
    } catch {}
  }
  detected = guess;
  return guess;
}

/** The reader's region: their own choice in Preferences, otherwise the phone's best guess. */
export function getRegion(): Region {
  const chosen = getPrefs().region;
  return chosen === 'GB' || chosen === 'IN' || chosen === 'INTL' ? chosen : detectRegion();
}

/** Stories this reader sees: news for everyone plus their own country's local news and tips.
 *  XX = the daily tip for readers outside the UK and India (UK and India readers get their own). */
export function regionCountries(region: Region = getRegion()): string[] {
  return region === 'INTL' ? ['INTL', 'XX'] : ['INTL', region];
}
