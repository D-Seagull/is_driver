import { QueryClient } from '@tanstack/react-query';

/**
 * Single shared QueryClient. Sane defaults for a mobile app on flaky LTE:
 * one retry, short stale time.
 *
 * refetchOnWindowFocus is OFF: it re-fetched *every* active query on each app
 * foreground, which is now redundant — realtime keeps data fresh via the socket
 * syncs, and the unread bell already refetches on the socket `connect` event.
 * refetchOnReconnect stays on to recover after a network drop.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
