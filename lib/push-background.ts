import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { clearTrayChat } from '@/lib/chat-notifications';
import { chatReadTag } from '@/lib/chat-ref';

/**
 * Background push task: the silent "chat read" push (a chat was read on the
 * web / another device while this app is in the background or closed) takes
 * that chat's banners out of the tray — which also lowers the launcher badge.
 *
 * Must be defined at module scope before the app renders, so it is imported
 * from the entry file (index.js): Android may start the JS just to run it.
 * Needs the expo-task-manager native module — absent in builds made before
 * it was added (an OTA can reach them), so everything here is guarded.
 */
export const PUSH_TASK = 'isfleet-push-background';

const isExpoGoAndroid =
  Constants.appOwnership === 'expo' && Platform.OS === 'android';

type TaskManagerModule = typeof import('expo-task-manager');
let TaskManager: TaskManagerModule | null = null;
if (!isExpoGoAndroid) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    TaskManager = require('expo-task-manager') as TaskManagerModule;
    TaskManager.defineTask(PUSH_TASK, async ({ data, error }) => {
      if (error) return;
      const tag = chatReadTag(data);
      if (tag) await clearTrayChat(tag);
    });
  } catch {
    TaskManager = null; // older build without the native module
  }
}

/** Hook the task to incoming pushes (after permission). Best-effort. */
export async function registerPushBackgroundTask(): Promise<void> {
  if (!TaskManager) return;
  try {
    if (!(await TaskManager.isAvailableAsync())) return;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require('expo-notifications') as typeof import('expo-notifications');
    await N.registerTaskAsync(PUSH_TASK);
  } catch (e) {
    console.warn('[push] background task not registered', e);
  }
}
