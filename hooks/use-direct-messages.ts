import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';

// History page size — matches the backend default `take` for direct messages.
const DM_PAGE_SIZE = 50;

// ─── Reply previews (shared shape between message and document quotes) ────

export interface MessageReplyPreview {
  id: string;
  content: string;
  deletedAt: string | null;
  sender: { id: string; firstName: string; lastName: string | null };
}

export interface DocReplyPreviewLite {
  id: string;
  fileName: string;
  fileType: 'PHOTO' | 'DOCUMENT';
  deletedAt: string | null;
  uploader: { id: string; firstName: string; lastName: string | null };
}

// ─── Direct (1-to-1) messages ─────────────────────────────────────────────

export interface DirectMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  deletedAt?: string | null;
  editedAt?: string | null;
  replyToId?: string | null;
  replyTo?: MessageReplyPreview | null;
  replyToDocumentId?: string | null;
  replyToDocument?: DocReplyPreviewLite | null;
  sender: { id: string; firstName: string; lastName: string | null; role: string };
  reactions?: { id: string; userId: string; emoji: string }[];
}

export interface Conversation {
  user: {
    id: string;
    firstName: string; lastName: string | null;
    role: string;
    avatar?: string | null;
    phone?: string | null;
    status?: string | null;
    statusUntil?: string | null;
    /** Plate of the truck this peer is assigned to (drivers only). */
    truckPlate?: string | null;
  };
  unreadCount: number;
  lastMessage: DirectMessage;
}

// ─── Query keys (centralised so listeners can target them precisely) ──────

export const dmKeys = {
  conversations: ['conversations'] as const,
  messages: (otherUserId: string) => ['messages', otherUserId] as const,
  unreadSummary: ['dm-unread-summary'] as const,
};

// ─── Queries ──────────────────────────────────────────────────────────────

export function useConversations() {
  return useQuery<Conversation[]>({
    queryKey: dmKeys.conversations,
    queryFn: async () => {
      const res = await api.get('/direct-messages/conversations');
      return res.data;
    },
  });
}

/**
 * Call once globally (in the drawer layout) so the DM unread badge + bell
 * stay live even when no chat screen is open — invalidates the conversations
 * query on new/read direct messages.
 */
export function useDmUnreadSync() {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: dmKeys.conversations });
    };
    socket.on('new_direct_message', invalidate);
    socket.on('new_direct_document', invalidate);
    socket.on('messages_read', invalidate);
    // Catch up after any (re)connect — events missed while the app was
    // backgrounded / the socket was down would otherwise only show on reload.
    socket.on('connect', invalidate);
    return () => {
      socket.off('new_direct_message', invalidate);
      socket.off('new_direct_document', invalidate);
      socket.off('messages_read', invalidate);
      socket.off('connect', invalidate);
    };
  }, [queryClient, token]);
}

export function useDirectMessages(otherUserId: string) {
  return useQuery<DirectMessage[]>({
    queryKey: dmKeys.messages(otherUserId),
    queryFn: async () => {
      const res = await api.get(`/direct-messages/${otherUserId}`);
      return res.data;
    },
    enabled: !!otherUserId,
  });
}

/**
 * Older-history pagination for a DM conversation. Reads the current message
 * cache, fetches the page just before the oldest one we hold, and merges it in
 * (the screen's timeline re-sorts by date, so order of insertion doesn't
 * matter). `hasMore` flips off once a short page comes back.
 *
 * Kept separate from `useDirectMessages` (which owns the latest page + socket
 * merges) so the initial load and the live cache stay untouched.
 */
export function useLoadOlderDirectMessages(otherUserId: string) {
  const qc = useQueryClient();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingRef = useRef(false);

  // Fresh pagination state whenever the conversation changes.
  useEffect(() => {
    setHasMore(true);
    setLoadingOlder(false);
    loadingRef.current = false;
  }, [otherUserId]);

  const loadOlder = useCallback(async () => {
    if (!otherUserId || loadingRef.current || !hasMore) return;
    const current =
      qc.getQueryData<DirectMessage[]>(dmKeys.messages(otherUserId)) ?? [];
    if (current.length === 0) return;
    const oldest = current.reduce((a, b) =>
      new Date(a.createdAt).getTime() <= new Date(b.createdAt).getTime() ? a : b,
    );
    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const res = await api.get<DirectMessage[]>(
        `/direct-messages/${otherUserId}`,
        { params: { before: oldest.createdAt, take: DM_PAGE_SIZE } },
      );
      const older = res.data ?? [];
      if (older.length > 0) {
        qc.setQueryData<DirectMessage[]>(
          dmKeys.messages(otherUserId),
          (prev = []) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = older.filter((m) => !seen.has(m.id));
            return fresh.length ? [...fresh, ...prev] : prev;
          },
        );
      }
      if (older.length < DM_PAGE_SIZE) setHasMore(false);
    } catch (e) {
      console.warn('[dm] loadOlder failed', e);
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [otherUserId, hasMore, qc]);

  return { loadOlder, loadingOlder, hasMore };
}

export function useChatUser(userId: string) {
  return useQuery({
    queryKey: ['chat-user', userId],
    queryFn: async () => {
      const res = await api.get(`/users/${userId}`);
      return res.data as {
        id: string;
        firstName: string;
        lastName: string | null;
        role: string;
        avatar: string | null;
      };
    },
    enabled: !!userId,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────

export function useMarkConversationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (otherUserId: string) => {
      const res = await api.post(`/direct-messages/${otherUserId}/read`);
      return res.data;
    },
    onSuccess: (_, otherUserId) => {
      queryClient.invalidateQueries({ queryKey: dmKeys.messages(otherUserId) });
      queryClient.invalidateQueries({ queryKey: dmKeys.conversations });
      queryClient.invalidateQueries({ queryKey: dmKeys.unreadSummary });
    },
  });
}

export function useDeleteDirectMessage() {
  return useMutation({
    mutationFn: async (messageId: string) => {
      await api.delete(`/direct-messages/messages/${messageId}`);
    },
  });
}

// 15-min edit window for own DM messages. Server broadcasts
// `dm_message_edited` so the cache patch is also handled by the gateway
// listener — but we patch optimistically here for instant feedback.
export function useEditDirectMessage(otherUserId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const res = await api.patch(`/direct-messages/messages/${id}`, {
        content,
      });
      return res.data as DirectMessage;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<DirectMessage[]>(
        dmKeys.messages(otherUserId),
        (old = []) =>
          old.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
      );
    },
  });
}
