import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { isPushForChat, type ChatRef } from '@/lib/chat-ref';

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
 * Take this chat's message banners out of the notification tray — the chat is
 * open on screen, so they're read (as in Viber). Other chats' banners stay.
 */
export async function clearChatNotifications(ref: ChatRef): Promise<void> {
  if (!Notifications) return;
  const N = Notifications;
  try {
    const shown = await N.getPresentedNotificationsAsync();
    await Promise.all(
      shown
        .filter((n) =>
          isPushForChat(n.request.content.data as Record<string, unknown> | undefined, ref),
        )
        .map((n) => N.dismissNotificationAsync(n.request.identifier)),
    );
  } catch {
    // Tray access is best-effort — never let it break the chat screen.
  }
}
