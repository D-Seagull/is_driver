import { useEffect } from 'react';
import { create } from 'zustand';

import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

interface PresenceState {
  onlineIds: Set<string>;
  /** Offline but seen within the last week → amber "away" instead of grey. */
  awayIds: Set<string>;
  setSnapshot: (ids: string[], awayIds: string[]) => void;
  setUserOnline: (id: string, online: boolean, away?: boolean) => void;
}

/**
 * RN twin of the web presence store. Backend pushes two events:
 *   - `presenceSnapshot` once on connect with the online + away company sets
 *   - `userPresenceChanged` per teammate flip thereafter
 *
 * Components ask `useUserPresence(id)` → 'online' | 'away' | 'offline' to pick
 * the dot colour.
 */
const usePresenceStore = create<PresenceState>((set) => ({
  onlineIds: new Set<string>(),
  awayIds: new Set<string>(),
  setSnapshot: (ids, awayIds) =>
    set({ onlineIds: new Set(ids), awayIds: new Set(awayIds) }),
  setUserOnline: (id, online, away = false) =>
    set((state) => {
      const nextOnline = new Set(state.onlineIds);
      const nextAway = new Set(state.awayIds);
      if (online) {
        nextOnline.add(id);
        nextAway.delete(id);
      } else {
        nextOnline.delete(id);
        if (away) nextAway.add(id);
        else nextAway.delete(id);
      }
      return { onlineIds: nextOnline, awayIds: nextAway };
    }),
}));

export function usePresenceSync() {
  const setSnapshot = usePresenceStore((s) => s.setSnapshot);
  const setUserOnline = usePresenceStore((s) => s.setUserOnline);
  const myId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    // Self is always online when this hook is mounted — pre-seed so the
    // drawer footer dot doesn't flash gray waiting for the snapshot.
    if (myId) setUserOnline(myId, true);

    const onSnapshot = (data: { userIds: string[]; awayUserIds?: string[] }) => {
      setSnapshot(data.userIds, data.awayUserIds ?? []);
    };
    const onChange = (data: {
      userId: string;
      online: boolean;
      away?: boolean;
    }) => {
      setUserOnline(data.userId, data.online, data.away);
    };

    socket.on('presenceSnapshot', onSnapshot);
    socket.on('userPresenceChanged', onChange);

    // Re-ask the backend for a fresh snapshot now that our listener
    // is wired up. Catches the case where the initial snapshot landed
    // before this effect ran (right after OTP verify).
    const requestSnapshot = () => socket.emit('requestPresence');
    if (socket.connected) requestSnapshot();
    socket.on('connect', requestSnapshot);

    return () => {
      socket.off('presenceSnapshot', onSnapshot);
      socket.off('userPresenceChanged', onChange);
      socket.off('connect', requestSnapshot);
    };
  }, [setSnapshot, setUserOnline, myId]);
}

export function useIsUserOnline(
  userId: string | null | undefined,
): boolean {
  return usePresenceStore((s) =>
    typeof userId === 'string' ? s.onlineIds.has(userId) : false,
  );
}

export type PresenceTier = 'online' | 'away' | 'offline';

/** Live presence tier for a user — online / recently-away / offline. */
export function useUserPresence(
  userId: string | null | undefined,
): PresenceTier {
  return usePresenceStore((s) => {
    if (typeof userId !== 'string') return 'offline';
    if (s.onlineIds.has(userId)) return 'online';
    if (s.awayIds.has(userId)) return 'away';
    return 'offline';
  });
}
