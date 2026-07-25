import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

// A company member as returned by GET /users. Trimmed to the fields the chat
// directory needs (name, role, phone, current truck) — the endpoint returns
// more, but we only type what we read.
export interface CompanyUser {
  id: string;
  firstName: string;
  lastName: string | null;
  role: string;
  phone: string | null;
  avatar: string | null;
  status?: string | null;
  statusUntil?: string | null;
  isActive: boolean;
  currentTruck?: { id: string; plate: string; status: string } | null;
}

/**
 * All members of the driver's company. Used by the chat directory to list
 * "other drivers" you can start a conversation with. The /users endpoint is
 * open to DRIVER role.
 */
export function useCompanyUsers() {
  return useQuery<CompanyUser[]>({
    queryKey: ['company-users'],
    queryFn: async () => {
      const res = await api.get('/users');
      return res.data;
    },
  });
}
