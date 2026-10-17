import { useEffect } from 'react';

import { useAppActive } from '@/hooks/use-app-active';
import { clearChatNotifications, type ChatRef } from '@/lib/chat-notifications';

/**
 * While this chat is focused AND the app is on screen (the same rule as read
 * receipts), keep its message banners out of the notification tray: once on
 * open, and again whenever `bump` changes (pass the message count) in case a
 * push slipped in just as the chat opened.
 */
export function useClearChatNotifications(
  ref: ChatRef | null,
  focused: boolean,
  bump?: unknown,
) {
  const appActive = useAppActive();
  const visible = focused && appActive;
  const key = ref
    ? 'tripId' in ref
      ? `t:${ref.tripId}`
      : 'userId' in ref
        ? `u:${ref.userId}`
        : `g:${ref.groupId}`
    : null;
  useEffect(() => {
    if (!visible || !ref) return;
    void clearChatNotifications(ref);
    // `key` stands for `ref` (a fresh object each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key, bump]);
}
