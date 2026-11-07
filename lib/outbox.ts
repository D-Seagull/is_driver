import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { create } from 'zustand';

import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

/*
 * Offline outbox for chat text. A message written without a connection used to
 * vanish (the socket emit was skipped or lost). Now every send goes through
 * here: it is saved on the device, shown in the chat at once as "pending", and
 * re-emitted with its client id until the server acknowledges it. The server
 * dedupes by that id (src/common/utils/send-dedupe.ts), so a retry whose ack
 * was lost never creates a second message.
 *
 * Kept identical in is-driver and is-manager (copy), like the other shared
 * chat files.
 */

export type OutboxKind = 'trip' | 'dm' | 'group';

export interface OutboxItem {
  clientId: string;
  kind: OutboxKind;
  /** tripId / peer user id / groupId */
  scopeId: string;
  /** Owner — items of another account on this device are left alone. */
  userId: string;
  content: string;
  replyToId: string | null;
  replyToDocumentId: string | null;
  createdAt: string;
  /** 'failed' = the server refused it (not retried automatically). */
  status: 'pending' | 'failed';
  error?: string;
}

const STORAGE_KEY = 'outbox.v1';
const ACK_TIMEOUT_MS = 15_000;
// Refused messages older than this are dropped on load.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface OutboxState {
  items: OutboxItem[];
}
export const useOutboxStore = create<OutboxState>(() => ({ items: [] }));

let hydration: Promise<void> | null = null;

function persist() {
  const items = useOutboxStore.getState().items;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)).catch(() => {});
}

function setItems(fn: (items: OutboxItem[]) => OutboxItem[]) {
  useOutboxStore.setState((s) => ({ items: fn(s.items) }));
  persist();
}

export function hydrateOutbox(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const stored = JSON.parse(raw) as OutboxItem[];
        const cutoff = Date.now() - MAX_AGE_MS;
        const keep = stored.filter((i) => new Date(i.createdAt).getTime() > cutoff);
        // Items enqueued before hydration finished stay (they are newer).
        useOutboxStore.setState((s) => {
          const have = new Set(s.items.map((i) => i.clientId));
          return { items: [...keep.filter((i) => !have.has(i.clientId)), ...s.items] };
        });
      })
      .catch(() => {});
  }
  return hydration;
}

function makeClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const EVENT: Record<OutboxKind, string> = {
  trip: 'sendMessage',
  dm: 'send_direct_message',
  group: 'send_group_message',
};

function payloadOf(item: OutboxItem): Record<string, unknown> {
  const base = {
    content: item.content,
    replyToId: item.replyToId,
    replyToDocumentId: item.replyToDocumentId,
  };
  if (item.kind === 'trip') {
    return { ...base, tripId: item.scopeId, tempId: item.clientId };
  }
  if (item.kind === 'dm') {
    return { ...base, receiverId: item.scopeId, clientId: item.clientId };
  }
  return { ...base, groupId: item.scopeId, clientId: item.clientId };
}

// ─── Delivery notifications ─────────────────────────────────────────────

type DeliveredListener = (item: OutboxItem, message: Record<string, unknown>) => void;
const listeners = new Set<DeliveredListener>();

/** Called with the saved message when the server acknowledges an outbox item. */
export function onOutboxDelivered(fn: DeliveredListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ─── Public API ─────────────────────────────────────────────────────────

export function enqueueMessage(input: {
  kind: OutboxKind;
  scopeId: string;
  content: string;
  replyToId?: string | null;
  replyToDocumentId?: string | null;
}): void {
  const userId = useAuthStore.getState().user?.id;
  const content = input.content.trim();
  if (!userId || !content || !input.scopeId) return;
  const item: OutboxItem = {
    clientId: makeClientId(),
    kind: input.kind,
    scopeId: input.scopeId,
    userId,
    content,
    replyToId: input.replyToId ?? null,
    replyToDocumentId: input.replyToDocumentId ?? null,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  setItems((items) => [...items, item]);
  void flushOutbox();
}

export function retryOutboxItem(clientId: string): void {
  setItems((items) =>
    items.map((i) =>
      i.clientId === clientId ? { ...i, status: 'pending', error: undefined } : i,
    ),
  );
  void flushOutbox();
}

export function discardOutboxItem(clientId: string): void {
  setItems((items) => items.filter((i) => i.clientId !== clientId));
}

let flushing = false;
let flushAgain = false;

/**
 * Send everything that is waiting, oldest first. Safe to call often: it does
 * nothing while offline, and runs one pass at a time. Within one conversation
 * order is kept — after a timeout the rest of that conversation waits.
 */
export async function flushOutbox(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    await hydrateOutbox();
    do {
      flushAgain = false;
      const me = useAuthStore.getState().user?.id;
      if (!me) return;
      const sock = getSocket();
      const stalled = new Set<string>();
      for (const item of [...useOutboxStore.getState().items]) {
        if (item.userId !== me || item.status !== 'pending') continue;
        if (!sock.connected) return;
        const lane = `${item.kind}:${item.scopeId}`;
        if (stalled.has(lane)) continue;
        try {
          const res = (await sock
            .timeout(ACK_TIMEOUT_MS)
            .emitWithAck(EVENT[item.kind], payloadOf(item))) as
            | Record<string, unknown>
            | undefined;
          if (res && typeof res.error === 'string' && res.error !== 'unauthenticated') {
            // Refused for good (not a member, company deactivated…).
            const error = res.error;
            setItems((items) =>
              items.map((i) =>
                i.clientId === item.clientId ? { ...i, status: 'failed', error } : i,
              ),
            );
          } else if (res && typeof res.id === 'string') {
            setItems((items) => items.filter((i) => i.clientId !== item.clientId));
            listeners.forEach((fn) => fn(item, res));
          } else {
            // No usable answer (token not valid yet…) — try again later.
            stalled.add(lane);
          }
        } catch {
          // Ack timed out / socket dropped: keep it, retry on the next pass.
          stalled.add(lane);
        }
      }
    } while (flushAgain);
  } finally {
    flushing = false;
  }
}

/** Items of one conversation belonging to the signed-in user. */
export function useOutboxItems(kind: OutboxKind, scopeId: string | null | undefined): OutboxItem[] {
  const items = useOutboxStore((s) => s.items);
  const me = useAuthStore((s) => s.user?.id);
  return useMemo(
    () =>
      scopeId
        ? items.filter((i) => i.kind === kind && i.scopeId === scopeId && i.userId === me)
        : [],
    [items, kind, scopeId, me],
  );
}

/** Wire the triggers: socket (re)connect, app foreground, and a slow retry tick. */
export function startOutboxRunner(): () => void {
  void hydrateOutbox().then(() => flushOutbox());
  const sock = getSocket();
  const onConnect = () => void flushOutbox();
  sock.on('connect', onConnect);
  const timer = setInterval(() => {
    if (useOutboxStore.getState().items.some((i) => i.status === 'pending')) {
      void flushOutbox();
    }
  }, 10_000);
  return () => {
    sock.off('connect', onConnect);
    clearInterval(timer);
  };
}
