import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const KEY = 'last-app-error';
export type AppError = { message: string; at: string };

/**
 * Catch any error the app doesn't handle itself (for example in a button tap or a timer).
 * Instead of the phone closing the app, `onFatal` shows a Reload screen, and the message is kept
 * so it can be shown in Preferences and sent to us in a screenshot.
 */
export function installCrashHandler(onFatal: (message: string) => void) {
  const EU = (globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, f?: boolean) => void; setGlobalHandler: (h: (e: unknown, f?: boolean) => void) => void } }).ErrorUtils;
  if (!EU) return;
  const previous = EU.getGlobalHandler();
  EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const message = String((error as Error)?.message ?? error).slice(0, 300);
    rememberError(message);
    sendError(message, !!isFatal);
    if (__DEV__) return previous(error, isFatal); // keep the red error screen while developing
    if (isFatal) onFatal(message);
  });
}

export function rememberError(message: string) {
  const e: AppError = { message: message.slice(0, 300), at: new Date().toISOString() };
  AsyncStorage.setItem(KEY, JSON.stringify(e)).catch(() => {});
}

export async function lastError(): Promise<AppError | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AppError) : null;
  } catch {
    return null;
  }
}

// crash reports: only the error message, app version, Android version and phone model, nothing about the reader
let sent = 0;
export function sendError(message: string, fatal = false) {
  if (__DEV__ || sent >= 5) return; // never flood: at most 5 reports each time the app is opened
  sent += 1;
  supabase
    .from('app_errors')
    .insert({
      message: message.slice(0, 400),
      fatal,
      app_version: String(Constants.expoConfig?.version ?? '').slice(0, 20),
      android_version: String(Platform.Version ?? '').slice(0, 20),
      device: String(Device.modelName ?? '').slice(0, 60),
    })
    .then(() => {}, () => {});
}
