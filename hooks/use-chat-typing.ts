import { useEffect, useRef, useState } from 'react';

import { fullName } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

type Target = { kind: 'dm'; peerId: string } | { kind: 'group'; groupId: string };

// Drop a typer if their stop signal never arrives (app killed, network drop).
const STALE_MS = 4000;
// Emit "stopped" after this long without a keystroke.
const IDLE_MS = 2000;

/**
 * "X is typing…" for DMs and groups — same model as the trip chat.
 *   DM:    typing_start / typing_stop  →  user_typing / user_stopped_typing
 *   Group: group_typing / group_stopped_typing (payload carries groupId + name)
 *
 * Returns the names currently typing (DM entries have no name — the screen
 * already knows the peer), plus `notifyTyping` for onChangeText and
 * `notifyStopTyping` for send / blur.
 */
export function useChatTyping(target: Target | null) {
  const myId = useAuthStore((s) => s.user?.id);
  const [typers, setTypers] = useState<Map<string, string | null>>(new Map());
  const timeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const key = target
    ? target.kind === 'dm'
      ? `dm:${target.peerId}`
      : `group:${target.groupId}`
    : null;

  // ── Listen ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!target) return;
    const sock = getSocket();
    const pending = timeouts.current;

    const drop = (userId: string) => {
      const t = pending.get(userId);
      if (t) clearTimeout(t);
      pending.delete(userId);
      setTypers((prev) => {
        if (!prev.has(userId)) return prev;
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    };
    const add = (userId: string, name: string | null) => {
      if (userId === myId) return;
      setTypers((prev) => new Map(prev).set(userId, name));
      const t = pending.get(userId);
      if (t) clearTimeout(t);
      pending.set(userId, setTimeout(() => drop(userId), STALE_MS));
    };

    if (target.kind === 'dm') {
      const onTyping = ({ userId }: { userId: string }) => {
        if (userId === target.peerId) add(userId, null);
      };
      const onStopped = ({ userId }: { userId: string }) => {
        if (userId === target.peerId) drop(userId);
      };
      sock.on('user_typing', onTyping);
      sock.on('user_stopped_typing', onStopped);
      return () => {
        sock.off('user_typing', onTyping);
        sock.off('user_stopped_typing', onStopped);
        pending.forEach(clearTimeout);
        pending.clear();
        setTypers(new Map());
      };
    }

    const onTyping = (p: {
      groupId: string;
      userId: string;
      firstName?: string | null;
      lastName?: string | null;
    }) => {
      if (p.groupId === target.groupId) add(p.userId, fullName(p) || null);
    };
    const onStopped = (p: { groupId: string; userId: string }) => {
      if (p.groupId === target.groupId) drop(p.userId);
    };
    sock.on('group_typing', onTyping);
    sock.on('group_stopped_typing', onStopped);
    return () => {
      sock.off('group_typing', onTyping);
      sock.off('group_stopped_typing', onStopped);
      pending.forEach(clearTimeout);
      pending.clear();
      setTypers(new Map());
    };
    // `key` captures the target; the object itself is re-created every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, myId]);

  // ── Emit (debounced, like the trip chat) ─────────────────────────────────
  const typingRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });

  const emitStop = (tg: Target | null = targetRef.current) => {
    if (!typingRef.current || !tg) return;
    typingRef.current = false;
    const sock = getSocket();
    if (tg.kind === 'dm') sock.emit('typing_stop', { receiverId: tg.peerId });
    else sock.emit('group_stopped_typing', { groupId: tg.groupId });
  };

  const notifyTyping = () => {
    const tg = targetRef.current;
    if (!tg) return;
    const sock = getSocket();
    if (!sock.connected) return;
    if (!typingRef.current) {
      typingRef.current = true;
      if (tg.kind === 'dm') sock.emit('typing_start', { receiverId: tg.peerId });
      else sock.emit('group_typing', { groupId: tg.groupId });
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => emitStop(), IDLE_MS);
  };

  const notifyStopTyping = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    emitStop();
  };

  // Leaving the chat (or switching to another) ends any "typing" we sent —
  // addressed to the chat we are leaving, captured when the effect ran.
  useEffect(() => {
    const leaving = target;
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      emitStop(leaving);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { typers, notifyTyping, notifyStopTyping };
}
