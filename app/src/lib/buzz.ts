import * as Haptics from 'expo-haptics';

/**
 * Phone vibration, only for the logo opening and the games. Never throws: on a phone or an app build
 * without the vibration module (older test builds) it simply does nothing.
 */
const safe = (p: () => Promise<void>) => {
  try {
    p().catch(() => {});
  } catch {
    // not available on this build
  }
};
export const buzz = {
  tick: () => safe(() => Haptics.selectionAsync()),
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  soft: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  thump: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  right: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  wrong: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
