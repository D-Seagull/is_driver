import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { documentKeys } from '@/hooks/use-documents';
import { DriverDocument } from '@/lib/documents-api';
import { fetchTripMessages } from '@/lib/trips-api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

export interface ChatMessage {
  id: string;
  tripId: string;
  senderId: string;
  content: string;
  createdAt: string;
  isRead?: boolean;
  sender: { id: string; name: string | null; role: string };
}

export function useTripChat(
  tripId: string | null | undefined,
  options: { isFocused?: boolean } = {},
) {
  // When `isFocused` is false (drawer opened a different screen), we still
  // listen for messages but stop auto-acknowledging them — otherwise the
  // sender sees ✓✓ even though the driver hasn't seen the message yet.
  const { isFocused = true } = options;
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const myId = user?.id ?? '';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Sync deduplication guard — checked BEFORE setState so that two concurrent
  // onNewMessage calls (StrictMode double-effect, transport upgrade reconnect, etc.)
  // cannot both pass the prev.some() check on the same React snapshot.
  const seenIds = useRef(new Set<string>());

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

  // Filter: own + dispatcher messages only
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

    const onConnect = () => {
      setConnected(true);
      joinRoom(); // re-join after every (re)connect
      markRead();
    };

    const onDisconnect = () => setConnected(false);

    const onNewMessage = (msg: ChatMessage) => {
      console.log('[chat] newMessage', msg.id, 'tripId=', msg.tripId);
      if (msg.tripId !== tripId) return;
      // Synchronous check before setState — prevents duplicate adds when two
      // listeners fire with the same message before React commits the first update
      if (seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      setMessages((prev) => [...prev, msg]);
      // Inbound message while screen is open → ack immediately so the sender
      // sees ✓✓.
      if (msg.senderId !== myIdRef.current) markRead();
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
      // Auto-ack inbound docs while focused — keeps ✓✓ in sync with messages.
      if (doc.uploadedBy !== myIdRef.current) markRead();
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('newMessage', onNewMessage);
    sock.on('newDocument', onNewDocument);
    sock.on('tripMessagesRead', onMessagesRead);

    // If already connected — join immediately
    if (sock.connected) {
      setConnected(true);
      joinRoom();
      markRead();
    }

    return () => {
      cancelled = true;
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('newMessage', onNewMessage);
      sock.off('newDocument', onNewDocument);
      sock.off('tripMessagesRead', onMessagesRead);
    };
  }, [tripId, token, qc]);

  // When focus returns (driver navigates back to the trip screen), catch up
  // any messages that arrived while away.
  useEffect(() => {
    if (!isFocused || !tripId) return;
    const sock = getSocket(token ?? undefined);
    if (sock.connected) sock.emit('markTripRead', { tripId });
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
  };

  return { messages: visible, isLoading, error, connected, sendMessage };
}
