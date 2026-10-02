import AsyncStorage from '@react-native-async-storage/async-storage';

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
