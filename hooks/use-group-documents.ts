import { useEffect } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';

import type { DocReplyPreviewLite } from './use-direct-messages';
import type { GroupMessageReplyPreview } from './use-groups';

export type FileDocType = 'PHOTO' | 'DOCUMENT';

// ─── Group document ───────────────────────────────────────────────────────

export interface GroupDocumentFull {
  id: string;
  groupId: string;
  uploadedBy: string;
  fileUrl: string;
  signedUrl: string;
  fileName: string;
  fileType: FileDocType;
  publicId: string | null;
  isRead: boolean;
  createdAt: string;
  deletedAt?: string | null;
  caption?: string | null;
  /** Reply pointing at a GroupMessage. */
  replyToMessageId?: string | null;
  replyTo?: GroupMessageReplyPreview | null;
  /** Reply pointing at another GroupMessageDocument. */
  replyToDocumentId?: string | null;
  replyToDocument?: DocReplyPreviewLite | null;
  uploader: { id: string; name: string | null; role: string };
  reactions?: { id: string; userId: string; emoji: string }[];
}

const QUERY_KEY = (groupId: string) =>
  ['group-documents', groupId] as const;

// ─── Queries ──────────────────────────────────────────────────────────────

export function useGroupDocuments(groupId: string) {
  return useQuery<GroupDocumentFull[]>({
    queryKey: QUERY_KEY(groupId),
    queryFn: async () => {
      const res = await api.get(`/group-messages/documents/group/${groupId}`);
      return res.data;
    },
    enabled: !!groupId,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────

export function useUploadGroupDocs(groupId: string) {
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
      form.append('groupId', groupId);
      if (replyToMessageId) form.append('replyToMessageId', replyToMessageId);
      if (replyToDocumentId)
        form.append('replyToDocumentId', replyToDocumentId);
      if (caption) form.append('caption', caption);
      files.forEach((f) => {
        form.append('files', {
          uri: f.uri,
          name: f.name,
          type: f.type,
        } as unknown as Blob);
      });
      const res = await api.post(
        '/group-messages/documents/upload-many',
        form,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      );
      return res.data as GroupDocumentFull[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY(groupId) });
    },
  });
}

export function useDeleteGroupDoc(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/group-messages/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY(groupId) });
    },
  });
}

// ─── Realtime sync ────────────────────────────────────────────────────────

export function useGroupDocsSocketSync(groupId: string | null) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!groupId) return;
    const socket = getSocket();

    const onNew = (doc: GroupDocumentFull) => {
      if (doc.groupId !== groupId) return;
      queryClient.setQueryData<GroupDocumentFull[]>(
        QUERY_KEY(groupId),
        (prev = []) => {
          if (prev.some((d) => d.id === doc.id)) return prev;
          return [doc, ...prev];
        },
      );
    };

    const onDeleted = ({ id }: { id: string }) => {
      // Soft delete — patch row so the chat shows a tombstone.
      queryClient.setQueryData<GroupDocumentFull[]>(
        QUERY_KEY(groupId),
        (prev = []) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, deletedAt: new Date().toISOString(), signedUrl: '' }
              : d,
          ),
      );
    };

    socket.on('new_group_document', onNew);
    socket.on('group_document_deleted', onDeleted);
    return () => {
      socket.off('new_group_document', onNew);
      socket.off('group_document_deleted', onDeleted);
    };
  }, [groupId, queryClient]);
}
