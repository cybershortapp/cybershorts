import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { getPrefs, setPrefs } from './prefs';
import { supabase } from './supabase';

type NotificationsModule = typeof import('expo-notifications');

// Expo Go can't do phone alerts and crashes if the alerts module is even loaded there,
// so it is only loaded inside the real app (the one built with EAS).
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const supported = (Platform.OS === 'android' || Platform.OS === 'ios') && !inExpoGo;
let N: NotificationsModule | null = null;
let token: string | null = null;

function notif(): NotificationsModule | null {
  if (!supported) return null;
  if (!N) {
    N = require('expo-notifications') as NotificationsModule;
    // show alerts even while the app is open
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  }
  return N;
}

export const alertsAvailable = supported;

async function channel(n: NotificationsModule) {
  if (Platform.OS === 'android') {
    await n.setNotificationChannelAsync('news', {
      name: 'Cyber news alerts',
      importance: n.AndroidImportance.HIGH,
      lightColor: '#2563F5',
    });
  }
}

/** Ask permission (once) and get this phone's push address. Returns null if not allowed. */
export async function enableAlerts(): Promise<string | null> {
  const n = notif();
  if (!n || !Device.isDevice) return null;
  try {
    await channel(n);
    let { status } = await n.getPermissionsAsync();
    if (status !== 'granted') status = (await n.requestPermissionsAsync()).status;
    setPrefs({ alertsAsked: true });
    if (status !== 'granted') {
      setPrefs({ alerts: false });
      return null;
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    token = (await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
    await syncAlerts();
    return token;
  } catch {
    return null;
  }
}

/** Send the current preferences to our server, so alerts match what the reader follows. */
export async function syncAlerts() {
  if (!token) return;
  const p = getPrefs();
  try {
    if (p.alerts) {
      await supabase.rpc('register_device', { p_token: token, p_products: p.products, p_terms: p.terms, p_alerts: true });
    } else {
      await supabase.rpc('remove_device', { p_token: token });
    }
  } catch {
    // no connection: it syncs again next time the app opens
  }
}

/** Turn alerts off: the phone is removed from our list completely. */
export async function disableAlerts() {
  setPrefs({ alerts: false });
  await syncAlerts();
}

/** When the app opens: if alerts were allowed before, refresh the push address quietly (no popup). */
export async function refreshAlerts() {
  const n = notif();
  if (!n || !Device.isDevice || !getPrefs().alerts || !getPrefs().alertsAsked) return;
  try {
    const { status } = await n.getPermissionsAsync();
    if (status === 'granted') await enableAlerts();
  } catch {}
}

/** Call `open(storyId)` when the reader taps an alert (also when the tap opened the app). */
export function onAlertTapped(open: (storyId: string) => void) {
  const n = notif();
  if (!n) return () => {};
  const handle = (r: { notification: { request: { content: { data?: Record<string, unknown> | null } } } } | null) => {
    const id = r?.notification.request.content.data?.storyId;
    if (typeof id === 'string') open(id);
  };
  n.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = n.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
