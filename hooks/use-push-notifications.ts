import { useEffect, useRef } from 'react';

import {
  deregisterPushToken,
  registerForPushNotifications,
} from '@/lib/push';
import { useAuthStore } from '@/store/auth';

/**
 * Registers an Expo push token with the backend whenever the user is logged
 * in, and unregisters it on logout. Notification *handling* (modal +
 * cache invalidation) lives in <PushNoticeOverlay /> so it can render UI.
 */
export function usePushNotifications() {
  const token = useAuthStore((s) => s.token);
  const expoTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      const old = expoTokenRef.current;
      if (old) {
        void deregisterPushToken(old);
        expoTokenRef.current = null;
      }
      return;
    }

    let cancelled = false;
    void registerForPushNotifications().then((expoToken) => {
      if (cancelled) return;
      expoTokenRef.current = expoToken;
    });
    return () => {
      cancelled = true;
    };
  }, [token]);
}
