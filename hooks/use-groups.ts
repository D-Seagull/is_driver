import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

// History page size — matches the backend default `take` for group messages.
const GROUP_PAGE_SIZE = 50;

import type {
  DocReplyPreviewLite,
  MessageReplyPreview,
} from './use-direct-messages';

// ─── Group entities ───────────────────────────────────────────────────────

export interface GroupManager {
  id: string;
  manager: {
    id: string;
    firstName: string; lastName: string | null;
    email: string;
    role: string;
  };
}

export interface ManagerGroup {
  id: string;
  firstName: string; lastName: string | null;
  type: string;
  createdBy: string;
  managers: GroupManager[];
}

// ─── Group messages ───────────────────────────────────────────────────────

export interface GroupMessageReplyPreview {
  id: string;
  content: string;
  deletedAt: string | null;
  sender: { id: string; firstName: string; lastName: string | null };
}

export interface GroupMessage {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
  /** System-authored notices ("added X") — rendered centred & muted. */
  isSystem?: boolean;
  createdAt: string;
  deletedAt?: string | null;
  editedAt?: string | null;
  replyToId?: string | null;
  replyTo?: GroupMessageReplyPreview | null;
  replyToDocumentId?: string | null;
  // Re-use the same lite preview shape — file fields match GroupDoc rows
  // sufficiently for quoting.
  replyToDocument?: DocReplyPreviewLite | null;
  sender: { id: string; firstName: string; lastName: string | null; role: string };
  reactions?: { id: string; userId: string; emoji: string }[];
}

// ─── Query keys ───────────────────────────────────────────────────────────

export const groupKeys = {
  list: ['manager-groups'] as const,
  driverList: ['driver-groups'] as const,
  detail: (id: string) => ['manager-groups', id] as const,
  messages: (groupId: string) => ['group-messages', groupId] as const,
  unread: ['group-unread-summary'] as const,
};

// ─── Driver groups (company-wide all-drivers group) ───────────────────────

export interface DriverGroup {
  id: string;
  name: string;
  avatar: string | null;
  type: string;
  memberCount: number;
  unreadCount: number;
}

/**
 * The groups a driver belongs to. Backed by the driver-only `/driver-groups`
 * endpoint (the manager `/groups` routes are role-locked). Today this returns
 * the single company-wide "All Drivers" group, created lazily server-side.
 */
export function useDriverGroups() {
  return useQuery<DriverGroup[]>({
    queryKey: groupKeys.driverList,
    queryFn: async () => {
      const res = await api.get('/driver-groups');
      return res.data;
    },
  });
}

// ─── Queries ──────────────────────────────────────────────────────────────

/**
 * Groups the current user is a member of. For drivers the API returns only
 * groups they belong to — the same endpoint is used by managers on the web
 * (privacy is enforced on the backend, not the client).
 */
export function useGroups() {
  return useQuery<ManagerGroup[]>({
    queryKey: groupKeys.list,
    queryFn: async () => {
      const res = await api.get('/groups/managers');
      return res.data;
    },
  });
}

export function useGroup(id: string) {
  return useQuery<ManagerGroup>({
    queryKey: groupKeys.detail(id),
    queryFn: async () => {
      // The backend doesn't expose a single-group endpoint — pick from list.
      const res = await api.get('/groups/managers');
      const groups: ManagerGroup[] = res.data;
      return groups.find((g) => g.id === id)!;
    },
    enabled: !!id,
  });
}

export function useGroupMessages(groupId: string) {
  return useQuery<GroupMessage[]>({
    queryKey: groupKeys.messages(groupId),
    queryFn: async () => {
      const res = await api.get(`/group-messages/${groupId}`);
      return res.data;
    },
    enabled: !!groupId,
  });
}

/**
 * Older-history pagination for a group chat — mirror of
 * `useLoadOlderDirectMessages`. Reads the cache, fetches the page before the
 * oldest held message, and merges it in (the screen re-sorts by date).
 * `hasMore` flips off once a short page comes back.
 */
export function useLoadOlderGroupMessages(groupId: string) {
  const qc = useQueryClient();
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingRef = useRef(false);

  useEffect(() => {
    setHasMore(true);
    setLoadingOlder(false);
    loadingRef.current = false;
  }, [groupId]);

  const loadOlder = useCallback(async () => {
    if (!groupId || loadingRef.current || !hasMore) return;
    const current =
      qc.getQueryData<GroupMessage[]>(groupKeys.messages(groupId)) ?? [];
    if (current.length === 0) return;
    const oldest = current.reduce((a, b) =>
      new Date(a.createdAt).getTime() <= new Date(b.createdAt).getTime() ? a : b,
    );
    loadingRef.current = true;
    setLoadingOlder(true);
    try {
      const res = await api.get<GroupMessage[]>(`/group-messages/${groupId}`, {
        params: { before: oldest.createdAt, take: GROUP_PAGE_SIZE },
      });
      const older = res.data ?? [];
      if (older.length > 0) {
        qc.setQueryData<GroupMessage[]>(
          groupKeys.messages(groupId),
          (prev = []) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = older.filter((m) => !seen.has(m.id));
            return fresh.length ? [...fresh, ...prev] : prev;
          },
        );
      }
      if (older.length < GROUP_PAGE_SIZE) setHasMore(false);
    } catch (e) {
      console.warn('[group] loadOlder failed', e);
    } finally {
      loadingRef.current = false;
      setLoadingOlder(false);
    }
  }, [groupId, hasMore, qc]);

  return { loadOlder, loadingOlder, hasMore };
}

// Reference preserved so the import is used downstream even when only msg
// previews are quoted — kept here to mirror DM exports.
export type { MessageReplyPreview };

// ─── Mutations ────────────────────────────────────────────────────────────

export function useMarkGroupRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      const res = await api.post(`/group-messages/${groupId}/read`);
      return res.data;
    },
    onSuccess: (_, groupId) => {
      queryClient.invalidateQueries({ queryKey: groupKeys.messages(groupId) });
      queryClient.invalidateQueries({ queryKey: groupKeys.unread });
      // Refresh the driver group list so the Groups tab badge clears.
      queryClient.invalidateQueries({ queryKey: groupKeys.driverList });
    },
  });
}

export function useDeleteGroupMessage() {
  return useMutation({
    mutationFn: async (messageId: string) => {
      await api.delete(`/group-messages/messages/${messageId}`);
    },
  });
}

// 15-min edit window — author-only, server-enforced.
export function useEditGroupMessage(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const res = await api.patch(`/group-messages/messages/${id}`, {
        content,
      });
      return res.data as GroupMessage;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<GroupMessage[]>(
        groupKeys.messages(groupId),
        (old = []) =>
          old.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
      );
    },
  });
}
