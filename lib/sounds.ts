import { AudioPlayer, createAudioPlayer } from 'expo-audio';

/**
 * Tiny wrapper around expo-audio for short notification chimes.
 * One AudioPlayer per asset is created lazily and reused — creating a new
 * player for every event leaks memory and adds latency.
 */
const players: Record<string, AudioPlayer | null> = {};

function getPlayer(key: 'message' | 'alarm'): AudioPlayer | null {
  if (players[key]) return players[key];
  try {
    const asset =
      key === 'message'
        ? require('../assets/sounds/is_message.mp3')
        : require('../assets/sounds/is_alarm.mp3');
    players[key] = createAudioPlayer(asset);
    return players[key];
  } catch (e) {
    console.warn(`[sound] failed to create ${key} player`, e);
    return null;
  }
}

function play(key: 'message' | 'alarm') {
  try {
    const p = getPlayer(key);
    if (!p) return;
    p.seekTo(0);
    p.play();
  } catch (e) {
    // expo-audio may not be available in Expo Go on some platforms — fail silently.
    console.warn(`[sound] play ${key} failed`, e);
  }
}

/** Chat-message chime. Restarts if already playing. */
export function playMessageSound() {
  play('message');
}

/** Alarm / reminder chime — louder, used by PushNoticeOverlay on ALARM push. */
export function playAlarmSound() {
  play('alarm');
}
