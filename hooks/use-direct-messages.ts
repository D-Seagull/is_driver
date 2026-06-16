import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

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

export function useChatUser(userId: string) {
  return useQuery({
    queryKey: ['chat-user', userId],
    queryFn: async () => {
      const res = await api.get(`/users/${userId}`);
      return res.data as { id: string; firstName: string; lastName: string | null; role: string };
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
