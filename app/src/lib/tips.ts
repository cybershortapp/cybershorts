import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * The tips the reader has ticked as done (the yellow "Your tip" box on the Focus card).
 * Kept only on the phone, newest first, so a tick stays ticked when they scroll back.
 */
const KEY = 'tips-done-v1';
const MAX = 500;
let done: string[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) done = JSON.parse(raw);
    notify();
  })
  .catch(() => {});

export function toggleTip(id: string) {
  done = done.includes(id) ? done.filter((x) => x !== id) : [id, ...done].slice(0, MAX);
  AsyncStorage.setItem(KEY, JSON.stringify(done)).catch(() => {});
  notify();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useTipDone(id: string): boolean {
  return useSyncExternalStore(subscribe, () => done.includes(id));
}
