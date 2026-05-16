import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  createTruckNote,
  deleteTruckNote,
  fetchDriverTruck,
  fetchTruckNotes,
} from '@/lib/truck-api';
import { getSocket } from '@/lib/socket';
import { useAuthStore, useIsAuth } from '@/store/auth';
import { tripKeys } from '@/hooks/use-trips';

export const truckKeys = {
  all: ['truck'] as const,
  mine: () => [...truckKeys.all, 'mine'] as const,
  notes: (id: string) => [...truckKeys.all, 'notes', id] as const,
};

export function useDriverTruck() {
  const isAuth = useIsAuth();
  return useQuery({
    queryKey: truckKeys.mine(),
    queryFn: fetchDriverTruck,
    enabled: isAuth,
  });
}

export function useTruckNotes(truckId: string | null | undefined) {
  return useQuery({
    queryKey: truckKeys.notes(truckId ?? ''),
    queryFn: () => fetchTruckNotes(truckId as string),
    enabled: !!truckId,
  });
}

export function useCreateTruckNote(truckId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      createTruckNote(truckId as string, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: truckKeys.notes(truckId ?? '') });
      // Also refresh driver-truck so embedded notes stay in sync
      qc.invalidateQueries({ queryKey: truckKeys.mine() });
    },
  });
}

export function useDeleteTruckNote(truckId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => deleteTruckNote(noteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: truckKeys.notes(truckId ?? '') });
      qc.invalidateQueries({ queryKey: truckKeys.mine() });
    },
  });
}

/**
 * Listen for `truckChanged` socket events emitted when a manager reassigns
 * a driver between trucks. Invalidates the driver's truck + trip queries so
 * the mobile app shows the new truck (or "no truck") immediately.
 */
export function useTruckChangedSync() {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const onTruckChanged = () => {
      qc.invalidateQueries({ queryKey: truckKeys.mine() });
      qc.invalidateQueries({ queryKey: tripKeys.active() });
      qc.invalidateQueries({ queryKey: tripKeys.list() });
    };
    socket.on('truckChanged', onTruckChanged);
    return () => {
      socket.off('truckChanged', onTruckChanged);
    };
  }, [qc, token]);
}
