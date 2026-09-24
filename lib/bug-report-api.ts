import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

export interface BugScreenshot {
  uri: string;
  name?: string | null;
  type?: string | null;
}

/**
 * Files a bug report from the driver app. Auto-captures the app name/version,
 * platform, and the screen the user was on, then POSTs multipart to the
 * backend (which stores it and pings admins in real time).
 */
export async function reportBug(
  description: string,
  screenshots: BugScreenshot[],
  route?: string,
): Promise<void> {
  const form = new FormData();
  form.append('description', description);
  form.append('appName', 'driver');
  form.append('appVersion', Constants.expoConfig?.version ?? '1.0.0');
  form.append('platform', `${Platform.OS} ${Platform.Version}`);
  if (route) form.append('route', route);

  screenshots.forEach((shot, i) => {
    // RN/Expo FormData takes the { uri, name, type } shape; TS models the web
    // File type here so we cast.
    form.append('screenshots', {
      uri: shot.uri,
      name: shot.name || `screenshot-${i + 1}.jpg`,
      type: shot.type || 'image/jpeg',
    } as unknown as Blob);
  });

  await api.post('/bug-reports', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
