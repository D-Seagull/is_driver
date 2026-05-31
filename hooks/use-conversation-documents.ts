import { useEffect } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

import type {
  DocReplyPreviewLite,
  MessageReplyPreview,
} from './use-direct-messages';

export type FileDocType = 'PHOTO' | 'DOCUMENT';

// ─── Conversation document (DM attachment) ────────────────────────────────

export interface ConversationDocumentFull {
  id: string;
  uploadedBy: string;
  otherUserId: string;
  fileUrl: string;
  signedUrl: string;
  fileName: string;
  fileType: FileDocType;
  publicId: string | null;
  isRead: boolean;
  createdAt: string;
  deletedAt?: string | null;
  caption?: string | null;
  /** Reply pointing at a DirectMessage. */
  replyToMessageId?: string | null;
  replyTo?: MessageReplyPreview | null;
  /** Reply pointing at another DirectMessageDocument. */
  replyToDocumentId?: string | null;
  replyToDocument?: DocReplyPreviewLite | null;
  uploader: { id: string; name: string | null; role: string };
  reactions?: { id: string; userId: string; emoji: string }[];
}

const QUERY_KEY = (otherUserId: string) =>
  ['conversation-documents', otherUserId] as const;

// ─── Queries ──────────────────────────────────────────────────────────────

export function useConversationDocuments(otherUserId: string) {
  return useQuery<ConversationDocumentFull[]>({
    queryKey: QUERY_KEY(otherUserId),
    queryFn: async () => {
      const res = await api.get(
        `/direct-messages/documents/conversation/${otherUserId}`,
      );
      return res.data;
    },
    enabled: !!otherUserId,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────

/**
 * Multipart upload of one or more files to a DM conversation. Supports
 * carrying a reply target (message OR document) and a single shared caption
 * applied to every file in the batch (Telegram-style).
 */
export function useUploadConversationDocs(otherUserId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      files,
      replyToMessageId,
      replyToDocumentId,
      caption,
    }: {
      files: { uri: string; name: string; type: string }[];
      replyToMessageId?: string | null;
      replyToDocumentId?: string | null;
      caption?: string | null;
    }) => {
      const form = new FormData();
      form.append('otherUserId', otherUserId);
      if (replyToMessageId) form.append('replyToMessageId', replyToMessageId);
      if (replyToDocumentId)
        form.append('replyToDocumentId', replyToDocumentId);
      if (caption) form.append('caption', caption);
      files.forEach((f) => {
        // RN FormData wants {uri, name, type} for file fields.
        form.append('files', {
          uri: f.uri,
          name: f.name,
          type: f.type,
        } as unknown as Blob);
      });
      const res = await api.post(
        '/direct-messages/documents/upload-many',
        form,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      );
      return res.data as ConversationDocumentFull[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY(otherUserId) });
    },
  });
}

export function useDeleteConversationDoc(otherUserId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/direct-messages/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY(otherUserId) });
    },
  });
}

// ─── Realtime sync ────────────────────────────────────────────────────────

/**
 * Subscribe to socket events for the currently open conversation. New docs
 * append to the cache; `direct_document_deleted` patches `deletedAt`
 * (soft delete) so the bubble can show a "Файл видалено" tombstone instead
 * of dropping out of the timeline.
 */
export function useConversationDocsSocketSync(otherUserId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!otherUserId) return;
    const socket = getSocket();

    const onNew = (doc: ConversationDocumentFull) => {
      const belongs =
        (doc.uploadedBy && doc.otherUserId === otherUserId) ||
        (doc.otherUserId && doc.uploadedBy === otherUserId);
      if (!belongs) return;
      queryClient.setQueryData<ConversationDocumentFull[]>(
        QUERY_KEY(otherUserId),
        (prev = []) => {
          if (prev.some((d) => d.id === doc.id)) return prev;
          return [doc, ...prev];
        },
      );
    };

    const onDeleted = ({ id }: { id: string }) => {
      // Soft delete — patch the row so the chat shows a tombstone instead
      // of dropping it from the timeline.
      queryClient.setQueryData<ConversationDocumentFull[]>(
        QUERY_KEY(otherUserId),
        (prev = []) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, deletedAt: new Date().toISOString(), signedUrl: '' }
              : d,
          ),
      );
    };

    socket.on('new_direct_document', onNew);
    socket.on('direct_document_deleted', onDeleted);
    return () => {
      socket.off('new_direct_document', onNew);
      socket.off('direct_document_deleted', onDeleted);
    };
  }, [otherUserId, queryClient]);
}
