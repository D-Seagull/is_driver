import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

// In Android Expo Go SDK 53+ importing expo-notifications THROWS at module
// load time via DevicePushTokenAutoRegistration.fx.js. iOS Expo Go still
// works via Apple's legacy host.exp.Exponent bundle, and EAS dev/prod builds
// always work. So we only skip the require for Android-Expo-Go.
const isExpoGoAndroid =
  Constants.appOwnership === 'expo' && Platform.OS === 'android';
type NotificationsModule = typeof import('expo-notifications');
const Notifications: NotificationsModule | null = isExpoGoAndroid
  ? null
  : // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-notifications') as NotificationsModule);

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tripKeys } from '@/hooks/use-trips';
import { truckKeys } from '@/hooks/use-truck';
import { registerTripActionCategories, TRIP_ACTIONS } from '@/lib/push';
import { getSocket } from '@/lib/socket';
import { answerDepart, updateDriverTripStatus } from '@/lib/trips-api';
import { Trip } from '@/lib/types';
import { playAlarmSound } from '@/lib/sounds';
import { useAuthStore } from '@/store/auth';

type NoticeKind = 'info' | 'newTrip' | 'depart';

interface Notice {
  kind: NoticeKind;
  title: string;
  body: string;
  tripId?: string;
  /** Which ask of "heading to loading?" this is (1st, 2nd, 3rd). */
  promptNo?: number;
}

type Payload = Record<string, unknown> | undefined;

// Re-asks come 20 min apart, so two within this window are one question.
const DEPART_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Identity of ONE question. Copies of it (push + socket, a push delivered
 * twice, the banner button + the modal) share the key; a re-ask 20 min later
 * has a new `promptNo`, so it's a new question.
 */
const questionKey = (n: Pick<Notice, 'kind' | 'tripId' | 'promptNo'>) =>
  n.kind === 'newTrip'
    ? `newTrip:${n.tripId}`
    : n.kind === 'depart'
      ? `depart:${n.tripId}:${n.promptNo ?? ''}`
      : null;

const promptNoOf = (data: Payload) =>
  typeof data?.promptNo === 'number' ? data.promptNo : undefined;

/**
 * In-app modals for pushes that arrive while the app is open, plus the
 * trip hand-off flow:
 *  - NEW_TRIP → "OK" accepts the trip (→ ACCEPTED), even mid-trip;
 *  - DEPART_PROMPT (push or `departPrompt` socket) → "Heading to loading?"
 *    Yes → ON_WAY, No → the backend asks again in 20 min;
 *  - anything else → plain notice with OK.
 * The same answers are available as buttons on the system banner when the
 * app is in the background (categories in `lib/push.ts`).
 *
 * Every question is asked ONCE: copies of it are dropped (see `questionKey`),
 * answering on the banner removes it from the modal queue, and answering in
 * the modal clears its banner from the notification tray.
 */
export function PushNoticeOverlay() {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const [queue, setQueue] = useState<Notice[]>([]);
  const notice = queue[0] ?? null;
  // Trips we've already sent "accepted" for — later duplicates are dropped.
  const acceptedRef = useRef(new Set<string>());
  // Questions already shown or answered (by `questionKey`) — never again.
  const seenRef = useRef(new Set<string>());
  // Banner responses already handled (a cold start may replay the last one).
  const handledRef = useRef(new Set<string>());
  // When "heading to loading?" was last put up per trip. A second copy within
  // DEPART_COOLDOWN_MS is a duplicate whatever its number says (the server
  // also refuses to ask twice; this is the safety net).
  const departShownRef = useRef(new Map<string, number>());

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: truckKeys.mine() });
    qc.invalidateQueries({ queryKey: tripKeys.all });
  }, [qc]);

  /** Status of a trip as far as the cached lists know (may be stale). */
  const knownStatus = useCallback(
    (tripId: string) => {
      const list = qc.getQueryData<Trip[]>(tripKeys.list());
      const active = qc.getQueryData<Trip | null>(tripKeys.active());
      return (
        list?.find((x) => x.id === tripId)?.status ??
        (active?.id === tripId ? active.status : undefined)
      );
    },
    [qc],
  );

  const enqueue = useCallback(
    (n: Notice) => {
      if (n.kind === 'newTrip' && n.tripId) {
        if (acceptedRef.current.has(n.tripId)) return;
        const st = knownStatus(n.tripId);
        if (st && st !== 'ASSIGNED') return; // already accepted elsewhere
      }
      if (n.kind === 'depart' && n.tripId) {
        const st = knownStatus(n.tripId);
        if (st && st !== 'ACCEPTED' && st !== 'ASSIGNED') return; // on its way
        const last = departShownRef.current.get(n.tripId);
        if (last && Date.now() - last < DEPART_COOLDOWN_MS) return;
        departShownRef.current.set(n.tripId, Date.now());
      }
      const key = questionKey(n);
      if (key) {
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
      }
      setQueue((q) =>
        n.kind === 'depart'
          ? // A newer ask for the same trip replaces an older one still queued.
            [...q.filter((x) => !(x.kind === 'depart' && x.tripId === n.tripId)), n]
          : [...q, n],
      );
    },
    [knownStatus],
  );

  /** The question was answered (anywhere): drop its copies and banners. */
  const settle = useCallback((n: Pick<Notice, 'kind' | 'tripId' | 'promptNo'>) => {
    const key = questionKey(n);
    if (key) seenRef.current.add(key);
    setQueue((q) =>
      q.filter((x) => !(x.kind === n.kind && x.tripId === n.tripId)),
    );
    if (!Notifications || !n.tripId) return;
    const type = n.kind === 'newTrip' ? 'NEW_TRIP' : 'DEPART_PROMPT';
    void Notifications.getPresentedNotificationsAsync()
      .then((list) =>
        Promise.all(
          list
            .filter((x) => {
              const d = x.request.content.data as Payload;
              return d?.type === type && d?.tripId === n.tripId;
            })
            .map((x) => Notifications!.dismissNotificationAsync(x.request.identifier)),
        ),
      )
      .catch(() => {});
  }, []);

  const close = () => setQueue((q) => q.slice(1));

  const accept = useCallback(
    async (tripId: string) => {
      if (acceptedRef.current.has(tripId)) return;
      acceptedRef.current.add(tripId);
      try {
        await updateDriverTripStatus(tripId, 'ACCEPTED');
      } catch (e) {
        acceptedRef.current.delete(tripId);
        console.warn('[push] failed to ACCEPT trip', e);
      }
      refresh();
    },
    [refresh],
  );

  const depart = useCallback(
    async (tripId: string, yes: boolean) => {
      try {
        await answerDepart(tripId, yes);
      } catch (e) {
        console.warn('[push] failed to answer depart', e);
      }
      refresh();
    },
    [refresh],
  );

  /** Turn a push payload into a notice (or nothing, for chat messages). */
  const fromPush = useCallback(
    (title: string | null, body: string | null, data: Payload): Notice | null => {
      const type = data?.type;
      const tripId = typeof data?.tripId === 'string' ? data.tripId : undefined;
      if (type === 'MESSAGE') return null;
      if (type === 'NEW_TRIP' && tripId) {
        return { kind: 'newTrip', title: title ?? t('push.noticeTitle'), body: body ?? '', tripId };
      }
      if (type === 'DEPART_PROMPT' && tripId) {
        return {
          kind: 'depart',
          title: title ?? t('push.departTitle'),
          body: body ?? '',
          tripId,
          promptNo: promptNoOf(data),
        };
      }
      return { kind: 'info', title: title ?? t('push.noticeTitle'), body: body ?? '' };
    },
    [t],
  );

  // Banner buttons (localized) — re-registered when the language changes.
  useEffect(() => {
    void registerTripActionCategories({
      ok: t('push.ok'),
      yes: t('push.yes'),
      no: t('push.no'),
    });
  }, [t]);

  // "Heading to loading?" also arrives over the socket, so the question shows
  // even when the push is silenced (do-not-disturb) or delayed.
  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const onPrompt = (p: {
      tripId: string;
      title?: string;
      body?: string;
      promptNo?: number;
    }) => {
      enqueue({
        kind: 'depart',
        title: t('push.departTitle'),
        body: p.body ?? p.title ?? '',
        tripId: p.tripId,
        promptNo: p.promptNo,
      });
    };
    socket.on('departPrompt', onPrompt);
    return () => {
      socket.off('departPrompt', onPrompt);
    };
  }, [token, enqueue, t]);

  useEffect(() => {
    // Notifications module is missing only in Android Expo Go.
    if (!Notifications) return;
    const N = Notifications;

    // Foreground: show our own modal. On Android a HIGH-importance channel
    // pops a heads-up banner regardless of `shouldShowBanner` — we dismiss
    // it explicitly so only the modal remains.
    const recvSub = N.addNotificationReceivedListener((n) => {
      const { title, body, data } = n.request.content;
      void N.dismissNotificationAsync(n.request.identifier);
      const payload = (data as Payload) ?? undefined;
      refresh();
      // Alarm chime — only for ALARM type so other pushes stay quiet.
      if (payload?.type === 'ALARM') playAlarmSound();
      const next = fromPush(title, body, payload);
      if (next) enqueue(next);
    });

    // Background / closed → the user tapped the banner or one of its buttons.
    const handleResponse = (r: import('expo-notifications').NotificationResponse) => {
      const id = `${r.notification.request.identifier}:${r.actionIdentifier}`;
      if (handledRef.current.has(id)) return;
      handledRef.current.add(id);
      void N.clearLastNotificationResponseAsync?.();
      refresh();

      const { title, body, data } = r.notification.request.content;
      const payload = (data as Payload) ?? undefined;
      const tripId =
        typeof payload?.tripId === 'string' ? payload.tripId : undefined;
      const promptNo = promptNoOf(payload);
      // Answered on the banner → never ask the same question again in-app.
      switch (r.actionIdentifier) {
        case TRIP_ACTIONS.ACCEPT:
          if (tripId) {
            settle({ kind: 'newTrip', tripId });
            void accept(tripId);
          }
          return;
        case TRIP_ACTIONS.DEPART_YES:
        case TRIP_ACTIONS.DEPART_NO:
          if (tripId) {
            settle({ kind: 'depart', tripId, promptNo });
            void depart(tripId, r.actionIdentifier === TRIP_ACTIONS.DEPART_YES);
          }
          return;
      }
      // Plain tap: ask the question in-app (plain notices need no modal —
      // the user already saw the banner).
      const next = fromPush(title, body, payload);
      if (next && next.kind !== 'info') enqueue(next);
    };
    const respSub = N.addNotificationResponseReceivedListener(handleResponse);
    // Cold start from a banner / button tap.
    void N.getLastNotificationResponseAsync().then((r) => {
      if (r) handleResponse(r);
    });

    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, [refresh, fromPush, enqueue, settle, accept, depart]);

  const onOk = () => {
    const n = notice;
    close();
    if (n?.kind === 'newTrip' && n.tripId) {
      settle(n); // also clears its banner from the tray
      void accept(n.tripId);
    }
  };

  const onDepart = (yes: boolean) => {
    const n = notice;
    close();
    if (n?.tripId) {
      settle(n);
      void depart(n.tripId, yes);
    }
  };

  // A trip question must be answered — only plain notices close on backdrop.
  const dismissable = notice?.kind === 'info';

  return (
    <Modal
      visible={!!notice}
      transparent
      animationType="fade"
      onRequestClose={() => dismissable && close()}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => dismissable && close()}
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
          {notice?.kind === 'depart' ? (
            <View style={styles.row}>
              <Pressable
                onPress={() => onDepart(false)}
                style={({ pressed }) => [
                  styles.btn,
                  styles.flex,
                  {
                    borderColor: c.border,
                    borderWidth: 1,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={[styles.btnText, { color: c.foreground }]}>
                  {t('push.no')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onDepart(true)}
                style={({ pressed }) => [
                  styles.btn,
                  styles.flex,
                  { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={[styles.btnText, { color: '#fff' }]}>
                  {t('push.yes')}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={onOk}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.btnText, { color: '#fff' }]}>
                {t('push.ok')}
              </Text>
            </Pressable>
          )}
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
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 4,
  },
  flex: { flex: 1 },
  btn: {
    alignSelf: 'stretch',
    paddingVertical: 10,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
