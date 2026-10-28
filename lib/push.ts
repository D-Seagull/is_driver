import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type { ExpoPushToken } from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { diagLog } from './diag-log';
import i18n from './i18n';
import { registerPushToken, unregisterPushToken } from './push-api';

// Lazy-load expo-notifications. On Android Expo Go SDK 53+ importing it
// statically eagerly runs `DevicePushTokenAutoRegistration` which THROWS
// ("Android Push notifications removed from Expo Go") and shows a red
// error overlay. On iOS Expo Go remote push still works (Apple legacy
// bundle host.exp.Exponent), and EAS dev/production builds always work.
// So the only case we MUST skip the require is Android-Expo-Go.
const isExpoGo = Constants.appOwnership === 'expo';
const isExpoGoAndroid = isExpoGo && Platform.OS === 'android';
type NotificationsModule = typeof import('expo-notifications');
let Notifications: NotificationsModule | null = null;
if (!isExpoGoAndroid) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications') as NotificationsModule;
  /**
   * The backend sends every push; whether it shows is decided here, the
   * moment it lands — only the phone knows for sure that the app is on screen
   * (the server's guess lagged, and a locked phone went silent).
   *  - on screen: no banner, no tray entry, no sound — the app shows it itself
   *    (PushNoticeOverlay modal, chat chime from the socket);
   *  - an alarm still rings through its channel;
   *  - not on screen (iOS `inactive`: tray pulled down, app switcher): the OS
   *    shows and sounds it as usual.
   * Background / closed: this handler doesn't run — the OS shows the push.
   */
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const onScreen = AppState.currentState === 'active';
      const type = (n.request.content.data as { type?: unknown } | null)?.type;
      const alarm = type === 'ALARM';
      diagLog(`push handler type=${String(type)} appState=${AppState.currentState} → ${onScreen ? 'hidden (on screen)' : 'shown'}`);
      return {
        shouldShowBanner: !onScreen,
        shouldShowList: !onScreen || alarm,
        shouldPlaySound: !onScreen || alarm,
        shouldSetBadge: false,
      };
    },
  });
  // Whether the app counts as "on screen" decides every push above — log it.
  AppState.addEventListener('change', (s) => diagLog(`appState → ${s}`));
}

/** Channels this version creates beyond the original two — reported to the
 *  backend so it may use them (PushService.channelFor). */
const ANDROID_CHANNELS = ['chat', 'alarm'];

/**
 * Ask permission, fetch the Expo push token, and register it on the backend.
 * Returns the token (or null if we couldn't acquire one — e.g. emulator,
 * permission denied, missing projectId, or Expo Go on Android post-SDK 53).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[push] skip register: not a real device (simulator/emulator). Push only works on physical hardware.');
    return null;
  }

  // Android Expo Go has remote push removed since SDK 53 (the Notifications
  // module isn't even loaded above). iOS Expo Go still works via Apple's
  // legacy bundle. EAS dev/prod builds always work.
  if (!Notifications) {
    console.warn('[push] skip register: Android Expo Go does not support remote push since SDK 53. Use an EAS dev or production build.');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') {
    console.warn('[push] skip register: notification permission not granted by user (status=' + status + ')');
    return null;
  }

  // Android needs a default channel before notifications are visible.
  if (Platform.OS === 'android') {
    // Names are shown in the phone's settings and CAN change after creation
    // (only importance / sound are fixed), so they follow the app language.
    await Notifications.setNotificationChannelAsync('default', {
      name: i18n.t('push.channels.other'),
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
    // Chat messages get their own channel: on Android 8+ the sound belongs to
    // the CHANNEL (the push's `sound` is ignored) and a channel's sound can't
    // change once created — hence a new id rather than editing 'default'.
    // The file is bundled via app.json → expo-notifications `sounds`.
    await Notifications.setNotificationChannelAsync('messages', {
      name: i18n.t('push.channels.fallback'),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'push_message.mp3',
      vibrationPattern: [0, 250, 250, 250],
    });
    // A channel's settings are fixed once it exists on a phone, so the
    // improved ones are NEW channels; the backend switches to them only for
    // devices that report having them (ANDROID_CHANNELS below), older app
    // versions keep getting `messages` / `default`.
    //
    // `chat`: every IS Fleet push. MAX importance + public on the lock
    // screen → pops up and shows in full while locked, and wakes the screen
    // on phones whose firmware does that for notifications.
    await Notifications.setNotificationChannelAsync('chat', {
      name: i18n.t('push.channels.chat'),
      importance: Notifications.AndroidImportance.MAX,
      sound: 'push_message.mp3',
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
    // `alarm`: the manager's alarm. Played on the ALARM audio stream, so it
    // rings on silent and vibrate like the system alarm clock; with "Do not
    // disturb" access granted (Settings → reliable notifications) it rings
    // through DND too.
    await Notifications.setNotificationChannelAsync('alarm', {
      name: i18n.t('push.channels.alarm'),
      importance: Notifications.AndroidImportance.MAX,
      sound: 'is_alarm.mp3',
      vibrationPattern: [0, 800, 400, 800, 400, 800, 400, 800],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    });
  }

  // EAS / Expo project id — required by Expo Push Service.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
      ?.projectId;

  let tokenResponse: ExpoPushToken;
  try {
    tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync failed', e);
    return null;
  }

  const token = tokenResponse.data;
  console.log('[push] got Expo token:', token);

  try {
    await registerPushToken(
      token,
      Platform.OS === 'ios'
        ? 'ios'
        : Platform.OS === 'android'
        ? 'android'
        : 'web',
      Platform.OS === 'android' ? ANDROID_CHANNELS : [],
    );
    console.log('[push] backend registered token for', Platform.OS);
  } catch (e) {
    console.warn('[push] backend register failed', e);
  }

  return token;
}

/**
 * Action buttons on the system banner (app in background / closed):
 *  - `NEW_TRIP`: OK → accept the trip;
 *  - `DEPART`: Yes / No → "Are we heading to loading?".
 * Identifiers must match the backend's `categoryId` and PushNoticeOverlay's
 * response handler. Buttons open the app so the answer can reach the API
 * with a fresh token. Re-register when the UI language changes.
 */
export const TRIP_ACTIONS = {
  ACCEPT: 'ACCEPT',
  DEPART_YES: 'DEPART_YES',
  DEPART_NO: 'DEPART_NO',
} as const;

export async function registerTripActionCategories(labels: {
  ok: string;
  yes: string;
  no: string;
}) {
  if (!Notifications) return;
  try {
    await Notifications.setNotificationCategoryAsync('NEW_TRIP', [
      {
        identifier: TRIP_ACTIONS.ACCEPT,
        buttonTitle: labels.ok,
        options: { opensAppToForeground: true },
      },
    ]);
    await Notifications.setNotificationCategoryAsync('DEPART', [
      {
        identifier: TRIP_ACTIONS.DEPART_YES,
        buttonTitle: labels.yes,
        options: { opensAppToForeground: true },
      },
      {
        identifier: TRIP_ACTIONS.DEPART_NO,
        buttonTitle: labels.no,
        options: { opensAppToForeground: true },
      },
    ]);
  } catch (e) {
    console.warn('[push] setNotificationCategoryAsync failed', e);
  }
}

export async function deregisterPushToken(token: string) {
  try {
    await unregisterPushToken(token);
  } catch (e) {
    console.warn('[push] backend unregister failed', e);
  }
}
