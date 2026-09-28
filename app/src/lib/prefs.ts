import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/** What the reader follows. Kept on the phone; only sent to our server when they switch on alerts or email. */
export type Prefs = {
  products: string[]; // names from the product list, e.g. "Mimecast", "Microsoft Defender"
  terms: string[]; // their own keywords when a product isn't in the list
  alerts: boolean; // phone alerts on/off
  alertsAsked: boolean; // we've asked for notification permission once
  email: string; // email they subscribed with ('' if none)
};

const KEY = 'prefs-v1';
const EMPTY: Prefs = { products: [], terms: [], alerts: true, alertsAsked: false, email: '' };

let state: Prefs = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) state = { ...EMPTY, ...JSON.parse(raw) };
  })
  .catch(() => {})
  .finally(() => {
    loaded = true;
    listeners.forEach((l) => l());
  });

export function getPrefs() {
  return state;
}

export function prefsLoaded() {
  return loaded;
}

export function setPrefs(change: Partial<Prefs>) {
  state = { ...state, ...change };
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Only letters, numbers, spaces and . + - & so a keyword can never break a search. */
export function cleanTerm(t: string) {
  return t.replace(/[^A-Za-z0-9 .+&-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
