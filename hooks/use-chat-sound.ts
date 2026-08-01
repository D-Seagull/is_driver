import { useEffect } from 'react';

import { getSocket } from '@/lib/socket';
import { playMessageSound } from '@/lib/sounds';
import { useAuthStore } from '@/store/auth';

// Soft rate-limit so a burst of messages doesn't stack overlapping chimes.
const RATE_LIMIT_MS = 500;
let lastPlayedAt = 0;

function ping() {
  const now = Date.now();
  if (now - lastPlayedAt < RATE_LIMIT_MS) return;
  lastPlayedAt = now;
  playMessageSound();
}

/**
 * Global chime for incoming DM / group messages. Mounted once in the drawer
 * layout so it fires on ANY screen — the backend joins every group room on
 * connect, so `new_group_message` reaches us app-wide, and `new_direct_message`
 * already lands in the personal room. Trip chat keeps its own sound inside
 * `useTripChat`.
 */
export function useChatSound() {
  const token = useAuthStore((s) => s.token);
  const myId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const onNew = (msg: { senderId?: string }) => {
      if (msg?.senderId && msg.senderId === myId) return;
      ping();
    };
    socket.on('new_direct_message', onNew);
    socket.on('new_group_message', onNew);
    return () => {
      socket.off('new_direct_message', onNew);
      socket.off('new_group_message', onNew);
    };
  }, [token, myId]);
}
