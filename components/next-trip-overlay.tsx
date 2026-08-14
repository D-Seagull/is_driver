import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { TripStatus } from '@/constants/trip-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tripKeys, useMyTrips } from '@/hooks/use-trips';
import { formatStopWindow } from '@/lib/format';
import { updateDriverTripStatus } from '@/lib/trips-api';
import { Trip } from '@/lib/types';

/**
 * Hand-off popup: the moment the driver's current trip flips to DELIVERED,
 * surface the next pre-assigned order (if any) in a modal with an OK button
 * that ACCEPTs it and opens it. This defers the "next order" announcement to
 * when the old one is actually finished — instead of interrupting the driver
 * with it at creation time (see the NEW_TRIP suppression in
 * `push-notice-overlay.tsx`).
 *
 * Detection is data-driven off the shared `useMyTrips()` cache, so it fires
 * whether the DELIVERED transition came from the driver themselves (optimistic
 * status update) or from a manager (socket `tripUpdated` → list refetch).
 */
export function NextTripOverlay() {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const qc = useQueryClient();
  const { data: trips = [] } = useMyTrips();

  // Snapshot of the last-seen status per trip. The first render only seeds it
  // (via `seeded`) so a fresh app-load with an already-DELIVERED trip doesn't
  // trigger a phantom popup.
  const prevStatuses = useRef<Map<string, TripStatus>>(new Map());
  const seeded = useRef(false);
  const [next, setNext] = useState<Trip | null>(null);

  useEffect(() => {
    const prev = prevStatuses.current;

    if (seeded.current && !next) {
      const justDelivered = trips.some((trip) => {
        const before = prev.get(trip.id);
        return (
          before !== undefined &&
          before !== 'DELIVERED' &&
          trip.status === 'DELIVERED'
        );
      });
      if (justDelivered) {
        // Next order = the still-unaccepted (ASSIGNED) trip that the backend
        // will promote to active — newest ASSIGNED, matching `findMyActiveTrip`.
        const candidate = trips
          .filter((trip) => trip.status === 'ASSIGNED')
          .sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0];
        if (candidate) setNext(candidate);
      }
    }

    const snapshot = new Map<string, TripStatus>();
    for (const trip of trips) snapshot.set(trip.id, trip.status);
    prevStatuses.current = snapshot;
    seeded.current = true;
  }, [trips, next]);

  const handleOk = async () => {
    const target = next;
    setNext(null);
    if (!target) return;
    try {
      await updateDriverTripStatus(target.id, 'ACCEPTED');
    } catch (e) {
      console.warn('[next-trip] failed to ACCEPT trip', e);
    }
    qc.invalidateQueries({ queryKey: tripKeys.active() });
    qc.invalidateQueries({ queryKey: tripKeys.list() });
    qc.invalidateQueries({ queryKey: tripKeys.detail(target.id) });
    router.push({ pathname: '/(driver)/trip', params: { tripId: target.id } });
  };

  const loadingStop = next?.stops?.find((s) => s.type === 'LOADING');
  const loadingAddress = loadingStop?.address?.trim();
  const loadingWindow = loadingStop ? formatStopWindow(loadingStop) : '';
  const bodyLines = [
    next?.orderNumber ? `#${next.orderNumber} · ${next.title}` : next?.title,
    loadingAddress
      ? t('trip.nextAssigned.loadingAt', { address: loadingAddress }) +
        (loadingWindow ? ` · ${loadingWindow}` : '')
      : loadingWindow || null,
    next?.truck?.plate ?? null,
  ].filter(Boolean) as string[];

  return (
    <Modal
      visible={!!next}
      transparent
      animationType="fade"
      onRequestClose={() => setNext(null)}
    >
      <Pressable style={styles.backdrop} onPress={() => setNext(null)}>
        {/* stop propagation so taps inside the card don't dismiss it */}
        <Pressable
          style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => {}}
        >
          <Text style={[styles.title, { color: c.foreground }]}>
            {t('trip.nextAssigned.title')}
          </Text>
          {bodyLines.length > 0 ? (
            <Text style={[styles.body, { color: c.foreground }]}>
              {bodyLines.join('\n')}
            </Text>
          ) : null}
          <Pressable
            onPress={handleOk}
            style={({ pressed }) => [
              styles.okBtn,
              { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.okText}>OK</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  okBtn: {
    alignSelf: 'stretch',
    paddingVertical: 10,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: 4,
  },
  okText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
