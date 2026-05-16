import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

/**
 * Tiny wrapper around expo-audio for short notification chimes.
 * One AudioPlayer per asset is created lazily and reused — creating a new
 * player for every event leaks memory and adds latency.
 *
 * IMPORTANT: iOS silent switch defaults to muting AmbientSound — without
 * `playsInSilentMode: true` the chime is inaudible whenever the user has
 * the ringer off (which is a lot of drivers most of the time). We set this
 * once on first use; it sticks for the whole app session.
 */
const players: Record<string, AudioPlayer | null> = {};
let audioModeReady: Promise<void> | null = null;

function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return audioModeReady;
  audioModeReady = setAudioModeAsync({
    playsInSilentMode: true,
    // Lets the alarm chime keep playing while the app is backgrounded.
    shouldPlayInBackground: true,
    // Don't fight other apps' audio — chime over them briefly, then yield.
    interruptionMode: 'mixWithOthers',
  }).catch((e) => {
    console.warn('[sound] setAudioModeAsync failed', e);
  });
  return audioModeReady;
}

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
  // Set audio mode once (resolves async); on cold first call the chime
  // might land before the mode is applied — acceptable for a one-frame race.
  void ensureAudioMode();
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
