import { useEffect } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { getSocket } from '@/lib/socket';

import type { DirectMessage } from './use-direct-messages';
import { dmKeys } from './use-direct-messages';
import type { GroupMessage } from './use-groups';
import { groupKeys } from './use-groups';

interface Options {
  /** Current DM peer — patches conversations & messages caches for them. */
  dmOtherUserId?: string | null;
  /** Current group — patches group messages cache. */
  groupId?: string | null;
  /** Used to ignore own-message echoes when needed. */
  myUserId?: string | null;
}

/**
 * Centralised WebSocket listener for chat events that affect cached message
 * rows: new messages, soft-deletes, and 15-min edits in DM and group chats.
 *
 * Trip chat uses its own dedicated hook (`useTripChat`) and is intentionally
 * not handled here — that hook owns the local message state and read marks.
 */
export function useChatEvents(opts: Options) {
  const qc = useQueryClient();
  const { dmOtherUserId, groupId, myUserId } = opts;

  useEffect(() => {
    const socket = getSocket();

    // ── DM: new message ────────────────────────────────────────────────
    const onNewDirect = (msg: DirectMessage) => {
      const otherId =
        msg.senderId === myUserId ? msg.receiverId : msg.senderId;
      qc.setQueryData<DirectMessage[]>(
        dmKeys.messages(otherId),
        (prev = []) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]),
      );
      qc.invalidateQueries({ queryKey: dmKeys.conversations });
      qc.invalidateQueries({ queryKey: dmKeys.unreadSummary });
    };

    // ── DM: soft delete ────────────────────────────────────────────────
    const onDmDeleted = ({ id }: { id: string }) => {
      // Patch every DM cache because we don't know which conversation the
      // deleted message belonged to without re-fetching.
      qc.getQueryCache()
        .findAll({ predicate: (q) => q.queryKey[0] === 'messages' })
        .forEach((q) => {
          qc.setQueryData<DirectMessage[]>(q.queryKey, (prev = []) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, content: '', deletedAt: new Date().toISOString() }
                : m,
            ),
          );
        });
    };

    // ── DM: 15-min edit ────────────────────────────────────────────────
    const onDmEdited = (updated: DirectMessage) => {
      qc.getQueryCache()
        .findAll({ predicate: (q) => q.queryKey[0] === 'messages' })
        .forEach((q) => {
          qc.setQueryData<DirectMessage[]>(q.queryKey, (prev = []) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
          );
        });
    };

    // ── DM: peer marked messages read → flip own ✓ to ✓✓ ──────────────
    // `readBy` is the user that *did* the reading. So messages I authored
    // to that user (senderId === me, receiverId === readBy) become isRead.
    const onMessagesRead = ({ readBy }: { readBy: string }) => {
      qc.setQueryData<DirectMessage[]>(
        dmKeys.messages(readBy),
        (prev = []) =>
          prev.map((m) =>
            m.senderId === myUserId && m.receiverId === readBy
              ? { ...m, isRead: true }
              : m,
          ),
      );
      qc.invalidateQueries({ queryKey: dmKeys.conversations });
    };

    // ── Group: new message ─────────────────────────────────────────────
    const onNewGroup = (msg: GroupMessage) => {
      if (!groupId || msg.groupId !== groupId) return;
      qc.setQueryData<GroupMessage[]>(
        groupKeys.messages(groupId),
        (prev = []) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]),
      );
      qc.invalidateQueries({ queryKey: groupKeys.unread });
    };

    // ── Group: soft delete ─────────────────────────────────────────────
    const onGroupDeleted = ({ id }: { id: string }) => {
      qc.getQueryCache()
        .findAll({ predicate: (q) => q.queryKey[0] === 'group-messages' })
        .forEach((q) => {
          qc.setQueryData<GroupMessage[]>(q.queryKey, (prev = []) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, content: '', deletedAt: new Date().toISOString() }
                : m,
            ),
          );
        });
    };

    // ── Group: 15-min edit ─────────────────────────────────────────────
    const onGroupEdited = (updated: GroupMessage) => {
      qc.getQueryCache()
        .findAll({ predicate: (q) => q.queryKey[0] === 'group-messages' })
        .forEach((q) => {
          qc.setQueryData<GroupMessage[]>(q.queryKey, (prev = []) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
          );
        });
    };

    socket.on('new_direct_message', onNewDirect);
    socket.on('dm_message_deleted', onDmDeleted);
    socket.on('dm_message_edited', onDmEdited);
    socket.on('messages_read', onMessagesRead);
    socket.on('new_group_message', onNewGroup);
    socket.on('group_message_deleted', onGroupDeleted);
    socket.on('group_message_edited', onGroupEdited);

    return () => {
      // Pass the exact callback to .off so we don't accidentally remove
      // listeners registered elsewhere for the same event.
      socket.off('new_direct_message', onNewDirect);
      socket.off('dm_message_deleted', onDmDeleted);
      socket.off('dm_message_edited', onDmEdited);
      socket.off('messages_read', onMessagesRead);
      socket.off('new_group_message', onNewGroup);
      socket.off('group_message_deleted', onGroupDeleted);
      socket.off('group_message_edited', onGroupEdited);
    };
  }, [qc, dmOtherUserId, groupId, myUserId]);
}

/**
 * Join/leave the group's socket room. Done from the chat screen when a
 * group is opened, so `new_group_message` arrives even when the group has
 * many silent observers.
 */
export function useJoinGroupRoom(groupId: string | null) {
  useEffect(() => {
    if (!groupId) return;
    const socket = getSocket();
    socket.emit('join_group', { groupId });
    return () => {
      socket.emit('leave_group', { groupId });
    };
  }, [groupId]);
}
