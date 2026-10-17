import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { TripStatus } from '@/constants/trip-status';
import { useMyTrips } from '@/hooks/use-trips';
import { askAcceptTrip, tripAskBody } from '@/lib/trip-ask';

/**
 * Hand-off: the moment the driver's current trip flips to DELIVERED, ask
 * about the next pre-assigned order (if one is still waiting for its OK) —
 * OK accepts it and opens it.
 *
 * It has no window of its own: the question goes into PushNoticeOverlay's
 * queue (`askAcceptTrip`), which asks about every trip once. When the same
 * trip was already asked there (push, in-app notice, data catch-up), this
 * only adds "open it after OK" instead of a second window.
 *
 * Detection is data-driven off the shared `useMyTrips()` cache, so it fires
 * whether the DELIVERED transition came from the driver themselves (optimistic
 * status update) or from a manager (socket `tripUpdated` → list refetch).
 */
export function NextTripOverlay() {
  const { t } = useTranslation();
  const { data: trips = [] } = useMyTrips();

  // Snapshot of the last-seen status per trip. The first render only seeds it
  // (via `seeded`) so a fresh app-load with an already-DELIVERED trip doesn't
  // trigger a phantom question.
  const prevStatuses = useRef<Map<string, TripStatus>>(new Map());
  const seeded = useRef(false);

  useEffect(() => {
    const prev = prevStatuses.current;

    if (seeded.current) {
      const justDelivered = trips.some((trip) => {
        const before = prev.get(trip.id);
        return (
          before !== undefined &&
          before !== 'DELIVERED' &&
          trip.status === 'DELIVERED'
        );
      });
      if (justDelivered) {
        // Next order = the still-unaccepted (ASSIGNED) trip the backend makes
        // current — the OLDEST one, matching `findMyActiveTrip` (loads go in
        // the order given). An already-accepted next trip needs no OK here:
        // the backend asks "heading to loading?" for it directly.
        const hasAcceptedNext = trips.some((trip) => trip.status === 'ACCEPTED');
        const candidate = hasAcceptedNext
          ? undefined
          : trips
              .filter((trip) => trip.status === 'ASSIGNED')
              .sort(
                (a, b) =>
                  new Date(a.createdAt).getTime() -
                  new Date(b.createdAt).getTime(),
              )[0];
        if (candidate) {
          askAcceptTrip({
            tripId: candidate.id,
            title: t('trip.nextAssigned.title'),
            body: tripAskBody(candidate, t),
            openOnAccept: true,
          });
        }
      }
    }

    const snapshot = new Map<string, TripStatus>();
    for (const trip of trips) snapshot.set(trip.id, trip.status);
    prevStatuses.current = snapshot;
    seeded.current = true;
  }, [trips, t]);

  return null;
}
