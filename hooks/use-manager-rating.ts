import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchManagerProfile,
  fetchManagerRatings,
  rateManager,
  type ManagerProfile,
  type ManagerRatingsResponse,
} from '@/lib/manager-api';

export const managerKeys = {
  profile: (id: string) => ['manager', id] as const,
  ratings: (id: string) => ['manager-ratings', id] as const,
};

export function useManagerProfile(managerId: string | null | undefined) {
  return useQuery<ManagerProfile>({
    queryKey: managerKeys.profile(managerId ?? ''),
    enabled: !!managerId,
    queryFn: () => fetchManagerProfile(managerId as string),
  });
}

export function useManagerRatings(managerId: string | null | undefined) {
  return useQuery<ManagerRatingsResponse>({
    queryKey: managerKeys.ratings(managerId ?? ''),
    enabled: !!managerId,
    queryFn: () => fetchManagerRatings(managerId as string),
  });
}

export function useRateManager(managerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      score: number;
      comment?: string;
      anonymous?: boolean;
    }) => rateManager(managerId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: managerKeys.ratings(managerId) });
      qc.invalidateQueries({ queryKey: managerKeys.profile(managerId) });
    },
  });
}
