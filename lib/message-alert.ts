import { vibrateMessage } from '@/lib/haptics';
import { playMessageSound } from '@/lib/sounds';
import { useAlertPrefs } from '@/store/alert-prefs';

// Soft rate-limit so a burst of messages doesn't stack overlapping chimes /
// buzzes. Shared across every arrival point (trip chat + global DM/group).
const RATE_LIMIT_MS = 500;
let lastAt = 0;

/**
 * Feedback for a genuine incoming message — call ONLY for messages that are not
 * from the current user and not system notices (callers already guard that).
 * Sound and vibration each respect their own Settings toggle.
 */
export function notifyIncomingMessage() {
  const now = Date.now();
  if (now - lastAt < RATE_LIMIT_MS) return;
  lastAt = now;
  const { sound, vibration } = useAlertPrefs.getState();
  if (sound) playMessageSound();
  if (vibration) vibrateMessage();
}
