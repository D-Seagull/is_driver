import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { documentKeys } from '@/hooks/use-documents';
import { deleteDocument, DriverDocument } from '@/lib/documents-api';
import { deleteTripMessage, fetchTripMessages } from '@/lib/trips-api';
import { getSocket } from '@/lib/socket';
import { playMessageSound } from '@/lib/sounds';
import { useAuthStore } from '@/store/auth';

export interface ChatMessage {
  id: string;
  tripId: string;
  senderId: string;
  content: string;
  createdAt: string;
  isRead?: boolean;
  isSystem?: boolean;
  sender: { id: string; name: string | null; role: string };
  // Session participants — used by the realtime layer to drop messages
  // belonging to a session the current user wasn't part of.
  session?: { driverId: string | null; managerId: string | null };
}

export function useTripChat(
  tripId: string | null | undefined,
  options: {
    isFocused?: boolean;
    /** Pass the same nearBottomRef used by the FlatList. When provided,
     *  inbound messages are only acknowledged (markTripRead) when the user
     *  is actually scrolled to the bottom — i.e. they can see the message. */
    nearBottomRef?: { current: boolean };
  } = {},
) {
  // When `isFocused` is false (drawer opened a different screen), we still
  // listen for messages but stop auto-acknowledging them — otherwise the
  // sender sees ✓✓ even though the driver hasn't seen the message yet.
  const { isFocused = true, nearBottomRef } = options;
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  // Map<userId, displayName> — who's currently typing in this trip.
  const [typers, setTypers] = useState<Map<string, string>>(new Map());
  const typerTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Sync deduplication guard — checked BEFORE setState so that two concurrent
  // onNewMessage calls (StrictMode double-effect, transport upgrade reconnect, etc.)
  // cannot both pass the prev.some() check on the same React snapshot.
  const seenIds = useRef(new Set<string>());

  // Stable ref to the latest markRead fn — lets the UI call markReadNow()
  // from scroll/pill handlers without needing a hook re-render.
  const markReadFnRef = useRef<() => void>(() => {});

  // Keep myId out of socket effect deps — auth hydrates after mount and would
  // otherwise tear down/re-create listeners (and re-fetch history) every time.
  const myIdRef = useRef(myId);
  useEffect(() => {
    myIdRef.current = myId;
  }, [myId]);

  // Same trick for focus — read via ref inside the socket effect so changing
  // focus doesn't tear down/re-attach listeners.
  const focusedRef = useRef(isFocused);
  useEffect(() => {
    focusedRef.current = isFocused;
  }, [isFocused]);

  // Filter: own + manager messages only
  const visible = messages.filter(
    (m) => m.senderId === myId || m.sender.role !== 'DRIVER',
  );

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;

    // Reset seen-IDs when we switch trips
    seenIds.current.clear();

    // ── Load history ────────────────────────────────────────────────────────
    setIsLoading(true);
    setError(null);
    fetchTripMessages(tripId)
      .then((h: ChatMessage[]) => {
        if (!cancelled) {
          // Pre-populate seen set so real-time events don't duplicate history
          h.forEach((m) => seenIds.current.add(m.id));
          setMessages(h);
        }
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? 'Failed to load messages'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    // ── Socket ──────────────────────────────────────────────────────────────
    const sock = getSocket(token ?? undefined);

    const joinRoom = () => {
      console.log('[chat] joinTrip →', tripId, '| sock.id=', sock.id);
      sock.emit('joinTrip', { tripId });
    };

    // Only mark messages as read while the chat screen is actually focused —
    // otherwise the sender thinks the driver has seen them.
    const markRead = () => {
      if (!focusedRef.current) return;
      sock.emit('markTripRead', { tripId });
    };
    // Keep the ref up-to-date so markReadNow() always calls the right closure.
    markReadFnRef.current = markRead;

    const onConnect = () => {
      setConnected(true);
      joinRoom(); // re-join after every (re)connect
      // On reconnect the user might be scrolled up — only ack if visible.
      if (!nearBottomRef || nearBottomRef.current) markRead();
    };

    const onDisconnect = () => setConnected(false);

    const onNewMessage = (msg: ChatMessage) => {
      console.log('[chat] newMessage', msg.id, 'tripId=', msg.tripId);
      if (msg.tripId !== tripId) return;

      // Privacy: drivers never see chats of sessions they weren't part of —
      // matters when the same driver still has an old trip open while the
      // new driver is now writing in it.
      const meId = myIdRef.current;
      const inSession =
        msg.session?.driverId === meId || msg.session?.managerId === meId;
      if (!inSession) return;

      // Synchronous check before setState — prevents duplicate adds when two
      // listeners fire with the same message before React commits the first update
      if (seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      setMessages((prev) => [...prev, msg]);
      // Ack only when the user can actually see the message (near bottom).
      // If scrolled up the "↓ N new" pill will appear; markReadNow() fires
      // when they scroll back down or tap the pill.
      if (msg.senderId !== meId) {
        if (!nearBottomRef || nearBottomRef.current) markRead();
        // Chime for incoming non-system messages.
        if (!msg.isSystem) playMessageSound();
      }
    };

    const onMessagesRead = (payload: {
      tripId: string;
      messageIds: string[];
      documentIds: string[];
    }) => {
      if (payload.tripId !== tripId) return;
      const msgIds = new Set(payload.messageIds ?? []);
      const docIds = new Set(payload.documentIds ?? []);
      if (msgIds.size > 0) {
        setMessages((prev) =>
          prev.map((m) => (msgIds.has(m.id) ? { ...m, isRead: true } : m)),
        );
      }
      if (docIds.size > 0) {
        // setQueryData alone sometimes didn't trigger the FlatList re-render
        // (the array reference is replaced but observers may miss the diff
        // when the query is also being concurrently fetched). Doing both is
        // belt-and-suspenders: instant patch + forced refetch from server.
        qc.setQueryData<DriverDocument[]>(documentKeys.trip(tripId), (old = []) =>
          old.map((d) => (docIds.has(d.id) ? { ...d, isRead: true } : d)),
        );
        qc.invalidateQueries({ queryKey: documentKeys.trip(tripId) });
      }
    };

    const onNewDocument = (doc: DriverDocument) => {
      if (doc.tripId !== tripId) return;
      qc.setQueryData<DriverDocument[]>(documentKeys.trip(tripId), (old = []) =>
        old.some((d) => d.id === doc.id) ? old : [...old, doc],
      );
      // Truck-scoped + global lists (used by Documents screen) just refetch.
      qc.invalidateQueries({ queryKey: documentKeys.all });
      if (doc.uploadedBy !== myIdRef.current) {
        if (!nearBottomRef || nearBottomRef.current) markRead();
      }
    };

    const onMessageDeleted = (payload: { tripId: string; messageId: string }) => {
      if (payload.tripId !== tripId) return;
      seenIds.current.delete(payload.messageId);
      setMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
    };

    const onDocumentDeleted = (payload: { tripId: string; documentId: string }) => {
      if (payload.tripId !== tripId) return;
      qc.setQueryData<DriverDocument[]>(documentKeys.trip(tripId), (old = []) =>
        old.filter((d) => d.id !== payload.documentId),
      );
      qc.invalidateQueries({ queryKey: documentKeys.all });
    };

    const onUserTyping = (payload: {
      tripId: string;
      user: { id: string; name: string | null };
    }) => {
      if (payload.tripId !== tripId) return;
      if (payload.user.id === myIdRef.current) return;
      setTypers((prev) => {
        const next = new Map(prev);
        next.set(payload.user.id, payload.user.name ?? 'Someone');
        return next;
      });
      const prevT = typerTimeoutsRef.current.get(payload.user.id);
      if (prevT) clearTimeout(prevT);
      const t = setTimeout(() => {
        setTypers((p) => {
          const n = new Map(p);
          n.delete(payload.user.id);
          return n;
        });
        typerTimeoutsRef.current.delete(payload.user.id);
      }, 4000);
      typerTimeoutsRef.current.set(payload.user.id, t);
    };

    const onUserStopTyping = (payload: { tripId: string; userId: string }) => {
      if (payload.tripId !== tripId) return;
      const t = typerTimeoutsRef.current.get(payload.userId);
      if (t) clearTimeout(t);
      typerTimeoutsRef.current.delete(payload.userId);
      setTypers((prev) => {
        const next = new Map(prev);
        next.delete(payload.userId);
        return next;
      });
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('newMessage', onNewMessage);
    sock.on('newDocument', onNewDocument);
    sock.on('tripMessagesRead', onMessagesRead);
    sock.on('messageDeleted', onMessageDeleted);
    sock.on('documentDeleted', onDocumentDeleted);
    sock.on('userTyping', onUserTyping);
    sock.on('userStopTyping', onUserStopTyping);

    // If already connected — join immediately
    if (sock.connected) {
      setConnected(true);
      joinRoom();
      if (!nearBottomRef || nearBottomRef.current) markRead();
    }

    return () => {
      cancelled = true;
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('newMessage', onNewMessage);
      sock.off('newDocument', onNewDocument);
      sock.off('tripMessagesRead', onMessagesRead);
      sock.off('messageDeleted', onMessageDeleted);
      sock.off('documentDeleted', onDocumentDeleted);
      sock.off('userTyping', onUserTyping);
      sock.off('userStopTyping', onUserStopTyping);
      typerTimeoutsRef.current.forEach((t) => clearTimeout(t));
      typerTimeoutsRef.current.clear();
    };
  }, [tripId, token, qc]);

  // When focus returns (driver navigates back to the trip screen), catch up
  // any messages that arrived while away — but only if they're visible
  // (user is near the bottom). If scrolled up, markReadNow() fires on scroll.
  useEffect(() => {
    if (!isFocused || !tripId) return;
    const sock = getSocket(token ?? undefined);
    if (sock.connected && (!nearBottomRef || nearBottomRef.current)) {
      sock.emit('markTripRead', { tripId });
    }
  }, [isFocused, tripId, token]);

  // ── Send ────────────────────────────────────────────────────────────────
  // No optimistic insert — server echoes the message back via `newMessage`,
  // and the optimistic copy would dupe (its temp id can't match the server id).
  const sendMessage = (content: string) => {
    const trimmed = content.trim();
    if (!tripId || !trimmed || !myId) return;

    const sock = getSocket(token ?? undefined);

    if (!sock.connected) {
      console.warn('[chat] send failed — not connected');
      return;
    }

    console.log('[chat] emit sendMessage tripId=', tripId, 'content=', trimmed.slice(0, 30));
    sock.emit('sendMessage', { tripId, content: trimmed });
    notifyStopTyping();
  };

  // ── Typing emit (debounced) ─────────────────────────────────────────────
  const isTypingRef = useRef(false);
  const stopTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyTyping = () => {
    if (!tripId) return;
    const sock = getSocket(token ?? undefined);
    if (!sock.connected) return;
    if (!isTypingRef.current) {
      sock.emit('typing', { tripId });
      isTypingRef.current = true;
    }
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    stopTypingTimeoutRef.current = setTimeout(() => {
      sock.emit('stopTyping', { tripId });
      isTypingRef.current = false;
    }, 2000);
  };
  const notifyStopTyping = () => {
    if (!tripId) return;
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    if (isTypingRef.current) {
      const sock = getSocket(token ?? undefined);
      sock.emit('stopTyping', { tripId });
      isTypingRef.current = false;
    }
  };
  // Cleanup on trip switch / unmount
  useEffect(() => {
    return () => {
      if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
      if (isTypingRef.current && tripId) {
        getSocket(token ?? undefined).emit('stopTyping', { tripId });
        isTypingRef.current = false;
      }
    };
  }, [tripId, token]);

  // Delete via HTTP — server then broadcasts `messageDeleted` to the room
  // and the listener above drops it from local state. We also patch optimistically.
  const deleteMessage = async (messageId: string) => {
    if (!tripId) return;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    seenIds.current.delete(messageId);
    try {
      await deleteTripMessage(messageId);
    } catch (e) {
      console.warn('[chat] deleteMessage failed', e);
    }
  };

  const removeDocument = async (documentId: string) => {
    if (!tripId) return;
    qc.setQueryData<DriverDocument[]>(documentKeys.trip(tripId), (old = []) =>
      old.filter((d) => d.id !== documentId),
    );
    try {
      await deleteDocument(documentId);
      qc.invalidateQueries({ queryKey: documentKeys.all });
    } catch (e) {
      console.warn('[chat] deleteDocument failed', e);
    }
  };

  return {
    messages: visible,
    isLoading,
    error,
    connected,
    sendMessage,
    deleteMessage,
    removeDocument,
    /** Call when the user scrolls to bottom or taps the "↓ new" pill so that
     *  messages that arrived while scrolled-up get marked as read. */
    markReadNow: () => markReadFnRef.current(),
    /** Map<userId, displayName> of users currently typing in this trip. */
    typers,
    /** Call from input onChangeText to broadcast "I'm typing". Debounced. */
    notifyTyping,
    /** Call on submit / blur / clear to broadcast "I stopped typing". */
    notifyStopTyping,
  };
}
