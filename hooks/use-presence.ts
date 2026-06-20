import { useEffect } from 'react';
import { create } from 'zustand';

import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

interface PresenceState {
  onlineIds: Set<string>;
  setSnapshot: (ids: string[]) => void;
  setUserOnline: (id: string, online: boolean) => void;
}

/**
 * RN twin of the web presence store. Backend pushes two events:
 *   - `presenceSnapshot` once on connect with the full company set
 *   - `userPresenceChanged` per teammate flip thereafter
 *
 * Components ask `useIsUserOnline(id)` to decide between rendering the
 * stored Online/Busy/Sleep/Vacation/Away or falling back to OFFLINE.
 */
const usePresenceStore = create<PresenceState>((set) => ({
  onlineIds: new Set<string>(),
  setSnapshot: (ids) => set({ onlineIds: new Set(ids) }),
  setUserOnline: (id, online) =>
    set((state) => {
      const next = new Set(state.onlineIds);
      if (online) next.add(id);
      else next.delete(id);
      return { onlineIds: next };
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

    const onSnapshot = (data: { userIds: string[] }) => {
      setSnapshot(data.userIds);
    };
    const onChange = (data: { userId: string; online: boolean }) => {
      setUserOnline(data.userId, data.online);
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
