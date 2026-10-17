import { AppState } from 'react-native';

import { vibrateMessage } from '@/lib/haptics';
import { playMessageSound } from '@/lib/sounds';
import { useAlertPrefs } from '@/store/alert-prefs';

// Soft rate-limit so a burst of messages doesn't stack overlapping chimes /
// buzzes. Shared across every arrival point (trip chat + global DM/group).
const RATE_LIMIT_MS = 500;
let lastAt = 0;

// Messages that arrived while the app was in the background sit in the
// socket's buffer and are handled the moment the app comes back — tapping a
// push opened the app to a second chime for a message the push had already
// rung for. So no chime while off screen, nor for RESUME_GRACE_MS after the
// app returns (whatever lands in that window is that backlog).
const RESUME_GRACE_MS = 2000;
let activeSince = AppState.currentState === 'active' ? Date.now() : 0;
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    if (!activeSince) activeSince = Date.now();
  } else {
    activeSince = 0;
  }
});

/**
 * Feedback for a genuine incoming message — call ONLY for messages that are not
 * from the current user and not system notices (callers already guard that).
 * Sound and vibration each respect their own Settings toggle.
 */
export function notifyIncomingMessage() {
  const now = Date.now();
  if (
    AppState.currentState !== 'active' ||
    !activeSince ||
    now - activeSince < RESUME_GRACE_MS
  )
    return;
  if (now - lastAt < RATE_LIMIT_MS) return;
  lastAt = now;
  const { sound, vibration } = useAlertPrefs.getState();
  if (sound) playMessageSound();
  if (vibration) vibrateMessage();
}
