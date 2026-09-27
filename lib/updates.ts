import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Alert, AppState, AppStateStatus } from 'react-native';

import i18n from '@/lib/i18n';

// Foreground checks are throttled — drivers flip in and out of the app all day
// and each check is a network round-trip to the EAS Update server.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

let lastCheck = 0;
let inFlight = false;
// Once an update is downloaded it is applied on the next cold start anyway, so
// we ask the user about it only once per session instead of on every foreground.
let prompted = false;

async function checkAndPrompt() {
  if (inFlight || prompted) return;
  if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
  inFlight = true;
  lastCheck = Date.now();
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    const result = await Updates.fetchUpdateAsync();
    if (!result.isNew) return;
    prompted = true;
    Alert.alert(i18n.t('update.title'), i18n.t('update.body'), [
      { text: i18n.t('update.later'), style: 'cancel' },
      { text: i18n.t('update.restart'), onPress: () => void Updates.reloadAsync() },
    ]);
  } catch {
    // Offline, server hiccup or a rejected bundle — not worth bothering the
    // user; the next foreground (or cold start) will try again.
  } finally {
    inFlight = false;
  }
}

/**
 * Over-the-air JS updates (EAS Update). Checks on launch and when the app
 * returns to the foreground, downloads silently, then offers a restart.
 * No-op in dev / Expo Go, where expo-updates is disabled.
 */
export function useOtaUpdates() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    void checkAndPrompt();
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void checkAndPrompt();
    });
    return () => sub.remove();
  }, []);
}
