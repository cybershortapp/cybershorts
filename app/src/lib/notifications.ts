import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getPrefs, setPrefs } from './prefs';
import { supabase } from './supabase';

const supported = Platform.OS === 'android' || Platform.OS === 'ios';
let token: string | null = null;

if (supported) {
  // show alerts even while the app is open
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function channel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('news', {
      name: 'Cyber news alerts',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#2563F5',
    });
  }
}

/** Ask permission (once) and get this phone's push address. Returns null if not allowed. */
export async function enableAlerts(): Promise<string | null> {
  if (!supported || !Device.isDevice) return null;
  try {
    await channel();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    setPrefs({ alertsAsked: true });
    if (status !== 'granted') {
      setPrefs({ alerts: false });
      return null;
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
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
  if (!supported || !Device.isDevice || !getPrefs().alerts || !getPrefs().alertsAsked) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') await enableAlerts();
  } catch {}
}

/** Call `open(storyId)` when the reader taps an alert (also when the tap opened the app). */
export function onAlertTapped(open: (storyId: string) => void) {
  if (!supported) return () => {};
  const handle = (r: Notifications.NotificationResponse | null) => {
    const id = r?.notification.request.content.data?.storyId;
    if (typeof id === 'string') open(id);
  };
  Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
