import { QueryClient } from '@tanstack/react-query';

/**
 * Single shared QueryClient. Sane defaults for a mobile app on flaky LTE:
 * one retry, short stale time, refetch on app focus.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
