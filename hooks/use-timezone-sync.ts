import * as Localization from 'expo-localization';
import { useEffect, useRef } from 'react';

import { setMyTimezone } from '@/lib/auth-api';
import { useAuthStore } from '@/store/auth';

/**
 * Detects the device's IANA timezone (e.g. "Europe/Warsaw") and pushes it
 * to the backend when:
 *  - the user logs in (token appears), or
 *  - the device timezone differs from what's stored on the server.
 *
 * Used by AlarmsService so a manager scheduling "08:00" for a driver in
 * Warsaw actually fires at 08:00 on that driver's clock, not the
 * manager's.
 */
export function useTimezoneSync() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      sentRef.current = null;
      return;
    }
    const cal = Localization.getCalendars()[0];
    const tz = cal?.timeZone;
    if (!tz) return;

    // Skip if backend already knows this exact TZ, and we've already synced
    // it once this session.
    if (sentRef.current === tz) return;
    if (user?.timezone === tz) {
      sentRef.current = tz;
      return;
    }
    setMyTimezone(tz)
      .then(() => {
        sentRef.current = tz;
      })
      .catch((e) => {
        console.warn('[tz] failed to push timezone', e);
      });
  }, [token, user?.timezone]);
}
