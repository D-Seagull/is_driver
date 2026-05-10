import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  Alarm,
  CreateAlarmPayload,
  UpdateAlarmPayload,
  createAlarm,
  deleteAlarmById,
  fetchMyAlarms,
  updateAlarmById,
} from '@/lib/alarms-api';
import { useIsAuth } from '@/store/auth';

export const alarmKeys = {
  all: ['alarms'] as const,
  my: () => [...alarmKeys.all, 'my'] as const,
};

export function useMyAlarms() {
  const isAuth = useIsAuth();
  return useQuery<Alarm[]>({
    queryKey: alarmKeys.my(),
    queryFn: fetchMyAlarms,
    enabled: isAuth,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useCreateAlarm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAlarmPayload) => createAlarm(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alarmKeys.my() });
    },
  });
}

export function useDeleteAlarm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAlarmById(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alarmKeys.my() });
    },
  });
}

export function useUpdateAlarm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAlarmPayload }) =>
      updateAlarmById(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alarmKeys.my() });
    },
  });
}
