import { useEffect } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

import { dmKeys } from './use-direct-messages';
import { groupKeys } from './use-groups';

/**
 * Minimal shape any cached message/document row must expose so the patcher
 * can drop fresh `reactions[]` onto it without caring about the rest of
 * the row's fields. Keeps this hook reusable across DM / group / trip /
 * doc caches without depending on each module's exact interfaces.
 */
interface ReactableRow {
  id: string;
  reactions?: MessageReactionRow[];
}

// ─── Reaction types ───────────────────────────────────────────────────────

/**
 * Targets for the generic reactions table. The string discriminator decides
 * which DB table the targetId points into, and which socket room receives
 * the broadcast.
 */
export type ReactionTarget =
  | 'TRIP'
  | 'DM'
  | 'GROUP'
  | 'TRIP_DOC'
  | 'DM_DOC'
  | 'GROUP_DOC';

export interface MessageReactionRow {
  id: string;
  userId: string;
  emoji: string;
}

interface ReactionChangedPayload {
  targetType: ReactionTarget;
  targetId: string;
  reactions: MessageReactionRow[];
}

// REST routes mirror the web client — backend exposes the same endpoints.
const REACT_ENDPOINT: Record<ReactionTarget, (id: string) => string> = {
  TRIP: (id) => `/messages/${id}/react`,
  DM: (id) => `/direct-messages/messages/${id}/react`,
  GROUP: (id) => `/group-messages/messages/${id}/react`,
  TRIP_DOC: (id) => `/documents/${id}/react`,
  DM_DOC: (id) => `/direct-messages/documents/${id}/react`,
  GROUP_DOC: (id) => `/group-messages/documents/${id}/react`,
};

// ─── Toggle reaction ──────────────────────────────────────────────────────

/**
 * Toggle a reaction (👍 / 😮 / 😢 / …) on a message or document. The server
 * replaces the user's previous reaction on the same target (one emoji per
 * user per target) and broadcasts `reaction_changed`.
 */
export function useToggleReaction() {
  return useMutation({
    mutationFn: async ({
      type,
      id,
      emoji,
    }: {
      type: ReactionTarget;
      id: string;
      emoji: string;
    }) => {
      const res = await api.post(REACT_ENDPOINT[type](id), { emoji });
      return res.data as MessageReactionRow[];
    },
  });
}

// ─── Realtime sync ────────────────────────────────────────────────────────

interface SyncOptions {
  /** Current trip chat — patches Message + TripDocument caches. */
  tripId?: string | null;
  /** Current DM conversation — patches DirectMessage + DM doc caches. */
  dmOtherUserId?: string | null;
  /** Current group chat — patches GroupMessage + GroupDoc caches. */
  groupId?: string | null;
}

/**
 * Subscribe to `reaction_changed` and patch every relevant React-Query
 * cache. Only caches whose key matches the provided ids receive the patch
 * — irrelevant updates from other chats are ignored.
 */
export function useReactionsSocketSync(opts: SyncOptions) {
  const queryClient = useQueryClient();
  const { tripId, dmOtherUserId, groupId } = opts;

  useEffect(() => {
    const socket = getSocket();

    const onChanged = (p: ReactionChangedPayload) => {
      const { targetType, targetId, reactions } = p;
      switch (targetType) {
        case 'TRIP': {
          if (!tripId) return;
          queryClient.setQueryData<ReactableRow[]>(
            ['trip-messages', tripId],
            (old = []) =>
              old.map((m) =>
                m.id === targetId ? { ...m, reactions } : m,
              ),
          );
          return;
        }
        case 'TRIP_DOC': {
          if (!tripId) return;
          queryClient.setQueryData<ReactableRow[]>(
            ['documents-trip', tripId],
            (old = []) =>
              old.map((d) =>
                d.id === targetId ? { ...d, reactions } : d,
              ),
          );
          return;
        }
        case 'DM': {
          if (!dmOtherUserId) return;
          queryClient.setQueryData<ReactableRow[]>(
            dmKeys.messages(dmOtherUserId),
            (old = []) =>
              old.map((m) =>
                m.id === targetId ? { ...m, reactions } : m,
              ),
          );
          return;
        }
        case 'DM_DOC': {
          if (!dmOtherUserId) return;
          queryClient.setQueryData<ReactableRow[]>(
            ['conversation-documents', dmOtherUserId],
            (old = []) =>
              old.map((d) =>
                d.id === targetId ? { ...d, reactions } : d,
              ),
          );
          return;
        }
        case 'GROUP': {
          if (!groupId) return;
          queryClient.setQueryData<ReactableRow[]>(
            groupKeys.messages(groupId),
            (old = []) =>
              old.map((m) =>
                m.id === targetId ? { ...m, reactions } : m,
              ),
          );
          return;
        }
        case 'GROUP_DOC': {
          if (!groupId) return;
          queryClient.setQueryData<ReactableRow[]>(
            ['group-documents', groupId],
            (old = []) =>
              old.map((d) =>
                d.id === targetId ? { ...d, reactions } : d,
              ),
          );
          return;
        }
      }
    };

    socket.on('reaction_changed', onChanged);
    return () => {
      socket.off('reaction_changed', onChanged);
    };
  }, [queryClient, tripId, dmOtherUserId, groupId]);
}
