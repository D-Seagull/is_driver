import { useEffect } from 'react';

import { clearTrayChat } from '@/lib/chat-notifications';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

/**
 * A chat was read on another device (web / desktop / the other phone):
 * the backend says `chat_read` and its banners leave this phone's tray.
 * While the app is closed the same news comes as a silent push instead
 * (lib/push-background.ts).
 */
export function useChatReadTray() {
  const token = useAuthStore((s) => s.token);
  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const onRead = (p: { tag?: unknown }) => {
      if (typeof p?.tag === 'string') void clearTrayChat(p.tag);
    };
    socket.on('chat_read', onRead);
    return () => {
      socket.off('chat_read', onRead);
    };
  }, [token]);
}
