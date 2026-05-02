import { useEffect, useRef, useState } from 'react';

import { fetchTripMessages } from '@/lib/trips-api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

export interface ChatMessage {
  id: string;
  tripId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: { id: string; name: string | null; role: string };
}

export function useTripChat(tripId: string | null | undefined) {
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
      .then((h) => {
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

    const onConnect = () => {
      setConnected(true);
      joinRoom(); // re-join after every (re)connect
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
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('newMessage', onNewMessage);

    // If already connected — join immediately
    if (sock.connected) {
      setConnected(true);
      joinRoom();
    }

    return () => {
      cancelled = true;
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('newMessage', onNewMessage);
    };
  }, [tripId, token]);

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
