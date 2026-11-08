import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteDocument,
  DriverDocument,
  fetchTripDocuments,
  fetchTruckDocuments,
  uploadDocuments,
  UploadFileLocal,
} from '@/lib/documents-api';
import { useIsAuth } from '@/store/auth';

export const documentKeys = {
  all: ['documents'] as const,
  trip: (tripId: string) => [...documentKeys.all, 'trip', tripId] as const,
  truck: (truckId: string) => [...documentKeys.all, 'truck', truckId] as const,
};

export function useTripDocuments(tripId: string | null | undefined) {
  const isAuth = useIsAuth();
  return useQuery<DriverDocument[]>({
    queryKey: documentKeys.trip(tripId ?? ''),
    queryFn: () => fetchTripDocuments(tripId as string),
    enabled: isAuth && !!tripId,
    staleTime: 10_000,
  });
}

export function useTruckDocuments(truckId: string | null | undefined) {
  const isAuth = useIsAuth();
  return useQuery<DriverDocument[]>({
    queryKey: documentKeys.truck(truckId ?? ''),
    queryFn: () => fetchTruckDocuments(truckId as string),
    enabled: isAuth && !!truckId,
    staleTime: 10_000,
  });
}

export function useUploadDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tripId,
      files,
      durationMs,
    }: {
      tripId: string;
      files: UploadFileLocal[];
      /** Voice message: its length in ms. */
      durationMs?: number | null;
    }) => uploadDocuments(tripId, files, { durationMs }),
    onSuccess: (_data, { tripId }) => {
      qc.invalidateQueries({ queryKey: documentKeys.trip(tripId) });
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: documentKeys.all });
    },
  });
}
