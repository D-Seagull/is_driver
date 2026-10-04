import { useEffect } from 'react';
import { create } from 'zustand';

import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

interface PresenceState {
  onlineIds: Set<string>;
  /** Offline but seen within the last week → amber "away" instead of grey. */
  awayIds: Set<string>;
  /** When a user went offline while we watched (ms) — fresher than the
   *  lastSeenAt the API returned before they left. */
  offlineAt: Map<string, number>;
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
  offlineAt: new Map<string, number>(),
  setSnapshot: (ids, awayIds) =>
    set({ onlineIds: new Set(ids), awayIds: new Set(awayIds) }),
  setUserOnline: (id, online, away = false) =>
    set((state) => {
      const nextOnline = new Set(state.onlineIds);
      const nextAway = new Set(state.awayIds);
      const nextOfflineAt = new Map(state.offlineAt);
      if (online) {
        nextOnline.add(id);
        nextAway.delete(id);
        nextOfflineAt.delete(id);
      } else {
        if (state.onlineIds.has(id)) nextOfflineAt.set(id, Date.now());
        nextOnline.delete(id);
        if (away) nextAway.add(id);
        else nextAway.delete(id);
      }
      return { onlineIds: nextOnline, awayIds: nextAway, offlineAt: nextOfflineAt };
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

/**
 * When the user was last in the app: the moment we saw them go offline, else
 * the server's `lastSeenAt`. null while they are online or nothing is known.
 */
export function useLastSeen(
  userId: string | null | undefined,
  serverLastSeen: string | null | undefined,
): Date | null {
  const online = useIsUserOnline(userId);
  const seenLeaving = usePresenceStore((s) =>
    typeof userId === 'string' ? s.offlineAt.get(userId) : undefined,
  );
  if (online) return null;
  if (seenLeaving) return new Date(seenLeaving);
  return serverLastSeen ? new Date(serverLastSeen) : null;
}
