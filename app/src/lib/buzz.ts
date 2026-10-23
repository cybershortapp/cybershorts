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

/**
 * The opening sound (the "Heartbeat"). Silent when the phone is on silent, and it plays alongside the
 * reader's own music instead of stopping it. Older builds without the sound player just stay quiet.
 */
type Player = { play: () => void; remove: () => void };
export function openingSound(): Player | null {
  try {
    // loaded only here, so a build without the sound player never fails at start-up
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require('expo-audio') as typeof import('expo-audio');
    audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    const player = audio.createAudioPlayer(require('../../assets/sounds/opening.mp3'));
    player.volume = 0.9;
    return {
      play: () => {
        try {
          player.play();
        } catch {
          // no sound, no problem
        }
      },
      remove: () => {
        try {
          player.remove();
        } catch {
          // already gone
        }
      },
    };
  } catch {
    return null;
  }
}
