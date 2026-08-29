import { Vibration } from 'react-native';

// A single, slightly longer buzz for an incoming chat message. Vibration.vibrate
// with a duration gives a real, controllable-length pulse on Android; iOS plays
// its standard system vibration. Tune the ms below to taste.
const BUZZ_MS = 200;

/** One-shot vibration for an incoming chat message. Fire-and-forget. */
export function vibrateMessage() {
  try {
    Vibration.vibrate(BUZZ_MS);
  } catch {
    // No vibrator / unsupported platform — ignore so it never breaks the flow.
  }
}
