import { useEffect } from 'react';

import { getSocket } from '@/lib/socket';
import { notifyIncomingMessage } from '@/lib/message-alert';
import { useAuthStore } from '@/store/auth';

/**
 * Global chime + vibration for incoming DM / group messages. Mounted once in
 * the drawer layout so it fires on ANY screen — the backend joins every group
 * room on connect, so `new_group_message` reaches us app-wide, and
 * `new_direct_message` already lands in the personal room. Trip chat triggers
 * its own feedback inside `useTripChat`. Sound and vibration each honour their
 * Settings toggle (see `notifyIncomingMessage`).
 */
export function useChatAlerts() {
  const token = useAuthStore((s) => s.token);
  const myId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const onNew = (msg: { senderId?: string }) => {
      if (msg?.senderId && msg.senderId === myId) return;
      notifyIncomingMessage();
    };
    socket.on('new_direct_message', onNew);
    socket.on('new_group_message', onNew);
    return () => {
      socket.off('new_direct_message', onNew);
      socket.off('new_group_message', onNew);
    };
  }, [token, myId]);
}
