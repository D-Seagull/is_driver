import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerPushToken, unregisterPushToken } from './push-api';

/**
 * Foreground policy: do NOT show the system banner — the app is open and
 * we display our own modal Alert with the message + OK button instead.
 * The notification still goes into the system list / center for history.
 *
 * Background / closed: this handler doesn't run — the OS shows the regular
 * banner from the push payload itself, no action buttons.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask permission, fetch the Expo push token, and register it on the backend.
 * Returns the token (or null if we couldn't acquire one — e.g. emulator,
 * permission denied, missing projectId, or Expo Go on Android post-SDK 53).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push only works on real devices.
    return null;
  }

  // Expo Go on Android stopped supporting remote push as of SDK 53.
  // Skip silently — for production push on Android use a dev/EAS build.
  const isExpoGo = Constants.appOwnership === 'expo';
  if (Platform.OS === 'android' && isExpoGo) {
    console.log('[push] skip register: remote push unsupported in Expo Go on Android (SDK 53+)');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') {
    return null;
  }

  // Android needs a default channel before notifications are visible.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  // EAS / Expo project id — required by Expo Push Service.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
      ?.projectId;

  let tokenResponse: Notifications.ExpoPushToken;
  try {
    tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync failed', e);
    return null;
  }

  const token = tokenResponse.data;

  try {
    await registerPushToken(
      token,
      Platform.OS === 'ios'
        ? 'ios'
        : Platform.OS === 'android'
        ? 'android'
        : 'web',
    );
  } catch (e) {
    console.warn('[push] backend register failed', e);
  }

  return token;
}

export async function deregisterPushToken(token: string) {
  try {
    await unregisterPushToken(token);
  } catch (e) {
    console.warn('[push] backend unregister failed', e);
  }
}
