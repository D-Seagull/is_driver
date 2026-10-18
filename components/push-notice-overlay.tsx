import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

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
import { tripKeys, useMyTrips } from '@/hooks/use-trips';
import { truckKeys } from '@/hooks/use-truck';
import { registerTripActionCategories, TRIP_ACTIONS } from '@/lib/push';
import { openChatFromPush } from '@/lib/push-route';
import { getSocket } from '@/lib/socket';
import { onAcceptTripAsk, tripAskBody } from '@/lib/trip-ask';
import { answerDepart, updateDriverTripStatus } from '@/lib/trips-api';
import { diagLog } from '@/lib/diag-log';
import { Trip } from '@/lib/types';
import { useAuthStore } from '@/store/auth';

type NoticeKind = 'info' | 'newTrip' | 'depart';

interface Notice {
  kind: NoticeKind;
  title: string;
  body: string;
  tripId?: string;
  /** Which ask of "heading to loading?" this is (1st, 2nd, 3rd). */
  promptNo?: number;
  /** Open the trip once the driver taps OK (next-trip hand-off). */
  openOnAccept?: boolean;
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

// Diagnostics: every trip question with its source and what the queue
// decided, plus mounts and answers — attached to bug reports (lib/diag-log).
// Added to chase duplicate questions on builds (2026-10-18).
let overlaySeq = 0;
const qlog = diagLog;

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
 *
 * The backend pushes everything; while the app is on screen lib/push.ts keeps
 * the banner and sound away and the push lands here as a modal. (Servers that
 * held the push back for an open app sent the `notice` socket event instead —
 * handled the same way.) A trip still waiting for its OK (ASSIGNED) is asked
 * from the trips data too, so the question survives a push that never came.
 * The next-trip hand-off (NextTripOverlay) asks through this queue as well —
 * one window per trip.
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
  const [inst] = useState(() => ++overlaySeq);
  useEffect(() => {
    qlog(`#${inst} mount`);
    return () => qlog(`#${inst} unmount`);
  }, [inst]);

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
    (n: Notice, src = '?') => {
      const tag = `#${inst} ${src} ${n.kind} trip=${n.tripId ?? '-'} no=${n.promptNo ?? '-'}`;
      if (n.kind === 'newTrip' && n.tripId) {
        if (acceptedRef.current.has(n.tripId)) return qlog(tag, 'drop: accepted');
        const st = knownStatus(n.tripId);
        if (st && st !== 'ASSIGNED') return qlog(tag, `drop: status ${st}`); // already accepted elsewhere
      }
      if (n.kind === 'depart' && n.tripId) {
        const st = knownStatus(n.tripId);
        if (st && st !== 'ACCEPTED' && st !== 'ASSIGNED') return qlog(tag, `drop: status ${st}`); // on its way
        const last = departShownRef.current.get(n.tripId);
        if (last && Date.now() - last < DEPART_COOLDOWN_MS) return qlog(tag, 'drop: cooldown');
        departShownRef.current.set(n.tripId, Date.now());
      }
      const key = questionKey(n);
      if (key) {
        if (seenRef.current.has(key)) {
          qlog(tag, 'drop: seen');
          // Already asked — just carry an "open it after OK" wish over.
          if (n.openOnAccept) {
            setQueue((q) =>
              q.map((x) =>
                x.kind === 'newTrip' && x.tripId === n.tripId
                  ? { ...x, openOnAccept: true }
                  : x,
              ),
            );
          }
          return;
        }
        seenRef.current.add(key);
      }
      qlog(tag, 'SHOW', `status=${n.tripId ? knownStatus(n.tripId) ?? 'unknown' : '-'}`);
      setQueue((q) =>
        n.kind === 'depart'
          ? // A newer ask for the same trip replaces an older one still queued.
            [...q.filter((x) => !(x.kind === 'depart' && x.tripId === n.tripId)), n]
          : [...q, n],
      );
    },
    [knownStatus, inst],
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

  useEffect(() => {
    qlog(
      `#${inst} modal`,
      notice ? `${notice.kind} trip=${notice.tripId ?? '-'} no=${notice.promptNo ?? '-'}` : 'closed',
      `queue=${queue.length}`,
    );
  }, [notice, queue.length, inst]);

  const close = () => setQueue((q) => q.slice(1));

  const accept = useCallback(
    async (tripId: string) => {
      if (acceptedRef.current.has(tripId)) return qlog(`#${inst} accept skip (already)`, tripId);
      acceptedRef.current.add(tripId);
      qlog(`#${inst} accept → ACCEPTED`, tripId);
      try {
        await updateDriverTripStatus(tripId, 'ACCEPTED');
      } catch (e) {
        acceptedRef.current.delete(tripId);
        // Not accepted after all — let the question come back.
        const key = questionKey({ kind: 'newTrip', tripId });
        if (key) seenRef.current.delete(key);
        console.warn('[push] failed to ACCEPT trip', e);
      }
      refresh();
    },
    [refresh, inst],
  );

  const depart = useCallback(
    async (tripId: string, yes: boolean) => {
      qlog(`#${inst} depart answer`, tripId, yes ? 'YES' : 'NO');
      try {
        await answerDepart(tripId, yes);
      } catch (e) {
        console.warn('[push] failed to answer depart', e);
      }
      refresh();
    },
    [refresh, inst],
  );

  /** Turn a push payload into a notice (or nothing, for chat messages). */
  const fromPush = useCallback(
    (title: string | null, body: string | null, data: Payload): Notice | null => {
      const type = data?.type;
      const tripId = typeof data?.tripId === 'string' ? data.tripId : undefined;
      // Chat messages show in the chat itself (socket + chime) — no modal.
      if (type === 'MESSAGE' || type === 'DM_MESSAGE' || type === 'GROUP_MESSAGE') {
        return null;
      }
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
      enqueue(
        {
          kind: 'depart',
          title: t('push.departTitle'),
          body: p.body ?? p.title ?? '',
          tripId: p.tripId,
          promptNo: p.promptNo,
        },
        `socket:departPrompt(${typeof p.promptNo})`,
      );
    };
    // Servers that held the push back while the app was open sent the news
    // as `notice` instead — still handled, so any server version works.
    const onNotice = (n: { title?: string; body?: string; data?: Payload }) => {
      refresh();
      const next = fromPush(n.title ?? null, n.body ?? null, n.data);
      if (next) enqueue(next, 'socket:notice');
    };
    socket.on('departPrompt', onPrompt);
    socket.on('notice', onNotice);
    return () => {
      socket.off('departPrompt', onPrompt);
      socket.off('notice', onNotice);
    };
  }, [token, enqueue, t, refresh, fromPush]);

  // A trip waiting for its OK is asked from the data as well — oldest first,
  // the order the backend makes them current. Covers a notice that never
  // arrived (phone locked the second it was sent) and an ignored banner.
  const { data: myTrips } = useMyTrips();
  useEffect(() => {
    const waiting = (myTrips ?? [])
      .filter((trip) => trip.status === 'ASSIGNED')
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    for (const trip of waiting) {
      enqueue({
        kind: 'newTrip',
        title: t('push.newTripTitle'),
        body: tripAskBody(trip, t),
        tripId: trip.id,
      }, 'data:ASSIGNED');
    }
  }, [myTrips, enqueue, t]);

  // The next-trip hand-off asks through the same queue (see lib/trip-ask).
  useEffect(
    () =>
      onAcceptTripAsk((a) =>
        enqueue({
          kind: 'newTrip',
          title: a.title,
          body: a.body,
          tripId: a.tripId,
          openOnAccept: a.openOnAccept,
        }, 'nextTrip'),
      ),
    [enqueue],
  );

  useEffect(() => {
    // Notifications module is missing only in Android Expo Go.
    if (!Notifications) return;
    const N = Notifications;

    // Foreground: show our own modal. On Android a HIGH-importance channel
    // pops a heads-up banner regardless of `shouldShowBanner` — we dismiss
    // it explicitly so only the modal remains.
    const recvSub = N.addNotificationReceivedListener((n) => {
      const { title, body, data } = n.request.content;
      const payload = (data as Payload) ?? undefined;
      // An alarm keeps its system notification: the `alarm` channel rings on
      // the ALARM stream (through silent mode, at alarm volume). Dismissing it
      // like the other pushes cut the ring off after the first buzz, and our
      // in-app chime plays on the MEDIA stream — silent with media volume down,
      // so some phones got only the vibration. The heads-up over the modal is
      // fine for an alarm.
      if (payload?.type !== 'ALARM') void N.dismissNotificationAsync(n.request.identifier);
      refresh();
      qlog(`#${inst} push received`, n.request.identifier, `type=${String(payload?.type)}`, `promptNo=${JSON.stringify(payload?.promptNo)}`, `appState=${AppState.currentState}`);
      const next = fromPush(title, body, payload);
      if (next) enqueue(next, 'push:received');
    });

    // Background / closed → the user tapped the banner or one of its buttons.
    const handleResponse = (r: import('expo-notifications').NotificationResponse) => {
      const id = `${r.notification.request.identifier}:${r.actionIdentifier}`;
      qlog(`#${inst} push response`, id, handledRef.current.has(id) ? 'dup' : 'new');
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
      // Plain tap on a chat message: open that chat at that message. The
      // active trip is read from the cache (the Trip tab shows it without an
      // id). On a cold start the navigator mounts first — next tick.
      const activeTripId = qc.getQueryData<Trip | null>(tripKeys.active())?.id;
      setTimeout(() => {
        openChatFromPush(payload, activeTripId);
      }, 0);
      // Plain tap: ask the question in-app (plain notices need no modal —
      // the user already saw the banner).
      const next = fromPush(title, body, payload);
      if (next && next.kind !== 'info') enqueue(next, 'push:tap');
    };
    const respSub = N.addNotificationResponseReceivedListener(handleResponse);
    // Cold start from a banner / button tap.
    void N.getLastNotificationResponseAsync().then((r) => {
      if (r) qlog(`#${inst} cold-start response replay`);
      if (r) handleResponse(r);
    });

    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, [refresh, fromPush, enqueue, settle, accept, depart, qc, inst]);

  const onOk = () => {
    const n = notice;
    close();
    if (n?.kind === 'newTrip' && n.tripId) {
      const tripId = n.tripId;
      settle(n); // also clears its banner from the tray
      void accept(tripId).then(() => {
        if (n.openOnAccept) {
          router.push({ pathname: '/(driver)/trip', params: { tripId } });
        }
      });
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
