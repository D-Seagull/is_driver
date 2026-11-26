import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { chatTag, trayChatTag, type ChatRef } from '@/lib/chat-ref';

// In Android Expo Go SDK 53+ importing expo-notifications THROWS at module
// load time; iOS Expo Go and EAS builds are fine. Same guard as PushNoticeOverlay.
const isExpoGoAndroid =
  Constants.appOwnership === 'expo' && Platform.OS === 'android';
type NotificationsModule = typeof import('expo-notifications');
const Notifications: NotificationsModule | null = isExpoGoAndroid
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-notifications') as NotificationsModule);

export type { ChatRef };

/**
 * Take one chat's message banners out of the notification tray (`tag` from
 * `chatTag`). The launcher badge counts tray entries, so it drops too.
 * Other chats' banners and other news stay.
 */
export async function clearTrayChat(tag: string): Promise<void> {
  if (!Notifications) return;
  const N = Notifications;
  try {
    const shown = await N.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter(
          (n) =>
            trayChatTag(
              n.request.identifier,
              n.request.content.data as Record<string, unknown> | undefined,
            ) === tag,
        )
        .map((n) => N.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Tray access is best-effort — never let it break the caller.
  }
}

/** The chat is open on screen, so its banners are read (as in Viber). */
export function clearChatNotifications(ref: ChatRef): Promise<void> {
  return clearTrayChat(chatTag(ref));
}
