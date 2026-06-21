import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

export interface DriverUnreadItem {
  tripId: string;
  unread: number;
  isActiveTrip: boolean;
  tripTitle: string;
  latestMessage: { content: string; senderName: string; createdAt: string } | null;
}

export interface DriverUnreadSummary {
  total: number;
  activeTripUnread: number;
  pastTripsUnread: number;
  /** { [tripId]: unreadCount } */
  tripUnread: Record<string, number>;
  items: DriverUnreadItem[];
}

export const DRIVER_UNREAD_KEY = ['driver-unread'] as const;

export function useDriverUnread() {
  return useQuery<DriverUnreadSummary>({
    queryKey: DRIVER_UNREAD_KEY,
    queryFn: async () => {
      const { data } = await api.get('/messages/unread/driver');
      return data;
    },
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

/** Call once globally (in drawer layout) to keep counts in sync via socket. */
export function useDriverUnreadSync() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: DRIVER_UNREAD_KEY });
    };

    // The backend used to re-broadcast every full chat message to the
    // company room just so this badge could invalidate. It now emits a
    // lightweight `tripUnreadChanged` for that purpose; `newMessage` is
    // kept on the trip room only (in-chat handlers in use-trip-chat
    // still listen for it there).
    socket.on('tripUnreadChanged', invalidate);
    socket.on('tripMessagesRead', invalidate);

    return () => {
      socket.off('tripUnreadChanged', invalidate);
      socket.off('tripMessagesRead', invalidate);
    };
  }, [queryClient, token]);
}
