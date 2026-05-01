import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchMyActiveTrip,
  fetchMyTrips,
  fetchTrip,
  fetchTripMessages,
  updateDriverTripStatus,
} from '@/lib/trips-api';
import { Trip } from '@/lib/types';
import { TripStatus } from '@/constants/trip-status';
import { useIsAuth } from '@/store/auth';

export const tripKeys = {
  all: ['trips'] as const,
  active: () => [...tripKeys.all, 'active'] as const,
  list: () => [...tripKeys.all, 'list'] as const,
  detail: (id: string) => [...tripKeys.all, 'detail', id] as const,
  messages: (id: string) => [...tripKeys.all, 'messages', id] as const,
};

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
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: tripKeys.active() });
      qc.invalidateQueries({ queryKey: tripKeys.list() });
      qc.invalidateQueries({ queryKey: tripKeys.detail(id) });
    },
  });
}
