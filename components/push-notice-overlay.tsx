import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tripKeys } from '@/hooks/use-trips';
import { truckKeys } from '@/hooks/use-truck';
import { updateDriverTripStatus } from '@/lib/trips-api';
import { playAlarmSound } from '@/lib/sounds';

interface Notice {
  title: string;
  body: string;
  /** Optional payload from the server, e.g. { type, tripId, truckId }. */
  data?: Record<string, unknown>;
}

/**
 * Renders a centered, dismissible modal whenever a push notification arrives
 * while the app is in the foreground. There is no explicit "OK" button — the
 * user closes by tapping the backdrop or the small × in the corner.
 *
 * Cache invalidation runs as soon as the notification arrives (or when the
 * user taps a background banner), independent of whether the user closes the
 * modal — the data is fresh by the time they look at it.
 */
export function PushNoticeOverlay() {
  const c = Colors[useColorScheme() ?? 'light'];
  const qc = useQueryClient();
  const [notice, setNotice] = useState<Notice | null>(null);

  /** OK handler — for NEW_TRIP also bumps the trip status to ACCEPTED so
   *  the manager knows the driver acknowledged it. Other notification
   *  types just close the modal (cache was already invalidated on receive). */
  const handleOk = async () => {
    const data = notice?.data;
    setNotice(null);
    if (data?.type === 'NEW_TRIP' && typeof data.tripId === 'string') {
      try {
        await updateDriverTripStatus(data.tripId, 'ACCEPTED');
      } catch (e) {
        console.warn('[push] failed to ACCEPT trip', e);
      }
      qc.invalidateQueries({ queryKey: tripKeys.active() });
      qc.invalidateQueries({ queryKey: tripKeys.list() });
      qc.invalidateQueries({ queryKey: tripKeys.detail(data.tripId) });
    }
  };

  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: truckKeys.mine() });
      qc.invalidateQueries({ queryKey: tripKeys.active() });
      qc.invalidateQueries({ queryKey: tripKeys.list() });
    };

    // Foreground: show our own modal. On Android a HIGH-importance channel
    // pops a heads-up banner regardless of `shouldShowBanner` — we dismiss
    // it explicitly so only the modal remains.
    const recvSub = Notifications.addNotificationReceivedListener((n) => {
      const { title, body, data } = n.request.content;
      void Notifications.dismissNotificationAsync(n.request.identifier);
      const payload = (data as Record<string, unknown> | undefined) ?? undefined;
      refresh();

      // Chat messages already arrive over the socket (handleNew adds them to
      // the chat in real time), so we don't want a modal interrupting the
      // user. The banner dismissal above takes care of the visual side.
      if (payload?.type === 'MESSAGE') return;

      // Alarm chime — only for ALARM type so we don't make noise on other
      // pushes (trip assignment, truck reassign).
      if (payload?.type === 'ALARM') playAlarmSound();

      setNotice({
        title: title ?? 'Сповіщення',
        body: body ?? '',
        data: payload,
      });
    });

    // Background/closed → user taps the system banner → app launches/foregrounds.
    // No modal here, just refresh.
    const respSub = Notifications.addNotificationResponseReceivedListener(
      refresh,
    );

    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, [qc]);

  return (
    <Modal
      visible={!!notice}
      transparent
      animationType="fade"
      onRequestClose={() => setNotice(null)}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => setNotice(null)}
      >
        {/* stop propagation so taps inside the card don't close it */}
        <Pressable
          style={[
            styles.card,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          onPress={() => {}}
        >
          <Text style={[styles.title, { color: c.foreground }]}>
            {notice?.title}
          </Text>
          {notice?.body ? (
            <Text style={[styles.body, { color: c.foreground }]}>
              {notice.body}
            </Text>
          ) : null}
          <Pressable
            onPress={handleOk}
            style={({ pressed }) => [
              styles.okBtn,
              {
                backgroundColor: c.primary,
                opacity: pressed ? 0.85 : 1,
              },
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
