import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  fetchMyActiveTrip,
  fetchMyTrips,
  fetchTrip,
  fetchTripMessages,
  updateDriverTripStatus,
} from '@/lib/trips-api';
import { getSocket } from '@/lib/socket';
import { Trip } from '@/lib/types';
import { TripStatus } from '@/constants/trip-status';
import { useAuthStore, useIsAuth } from '@/store/auth';

export const tripKeys = {
  all: ['trips'] as const,
  active: () => [...tripKeys.all, 'active'] as const,
  list: () => [...tripKeys.all, 'list'] as const,
  detail: (id: string) => [...tripKeys.all, 'detail', id] as const,
  messages: (id: string) => [...tripKeys.all, 'messages', id] as const,
};

/**
 * Keep the driver's trip list / active trip live: the backend emits
 * `tripUpdated` to the driver's personal room whenever a manager creates,
 * reassigns, or changes the status of one of their trips. Mount once in the
 * drawer layout. Without this, trip changes only showed after an app reload.
 */
export function useTripsSync() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    };
    socket.on('tripUpdated', invalidate);
    return () => {
      socket.off('tripUpdated', invalidate);
    };
  }, [queryClient, token]);
}

export function useActiveTrip() {
  const isAuth = useIsAuth();
  return useQuery<Trip | null>({
    queryKey: tripKeys.active(),
    queryFn: fetchMyActiveTrip,
    enabled: isAuth,
    // Poll every 20 s so a newly assigned trip shows up without manual refresh.
    refetchInterval: 20_000,
    staleTime: 10_000,
  });
}

export function useMyTrips() {
  const isAuth = useIsAuth();
  return useQuery<Trip[]>({
    queryKey: tripKeys.list(),
    queryFn: fetchMyTrips,
    enabled: isAuth,
    staleTime: 10_000,
  });
}

export function useTrip(id: string | null | undefined) {
  return useQuery<Trip>({
    queryKey: tripKeys.detail(id ?? ''),
    queryFn: () => fetchTrip(id as string),
    enabled: !!id,
  });
}

export function useTripMessages(id: string | null | undefined) {
  return useQuery({
    queryKey: tripKeys.messages(id ?? ''),
    queryFn: () => fetchTripMessages(id as string),
    enabled: !!id,
  });
}

export function useUpdateMyTripStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TripStatus }) =>
      updateDriverTripStatus(id, status),
    // Optimistic — the badge/picker flips instantly; we reconcile on settle.
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: tripKeys.all });
      const prevActive = qc.getQueryData<Trip | null>(tripKeys.active());
      const prevList = qc.getQueryData<Trip[]>(tripKeys.list());
      const prevDetail = qc.getQueryData<Trip>(tripKeys.detail(id));
      qc.setQueryData<Trip | null>(tripKeys.active(), (t) =>
        t && t.id === id ? { ...t, status } : t,
      );
      qc.setQueryData<Trip[]>(tripKeys.list(), (l) =>
        l?.map((t) => (t.id === id ? { ...t, status } : t)),
      );
      qc.setQueryData<Trip>(tripKeys.detail(id), (t) =>
        t ? { ...t, status } : t,
      );
      return { prevActive, prevList, prevDetail };
    },
    onError: (_e, { id }, ctx) => {
      if (!ctx) return;
      qc.setQueryData(tripKeys.active(), ctx.prevActive);
      qc.setQueryData(tripKeys.list(), ctx.prevList);
      qc.setQueryData(tripKeys.detail(id), ctx.prevDetail);
    },
    onSettled: (_data, _e, { id }) => {
      qc.invalidateQueries({ queryKey: tripKeys.active() });
      qc.invalidateQueries({ queryKey: tripKeys.list() });
      qc.invalidateQueries({ queryKey: tripKeys.detail(id) });
    },
  });
}
