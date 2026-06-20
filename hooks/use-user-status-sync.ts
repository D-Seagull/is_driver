import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth';
import { DriverUserStatus } from '@/lib/auth-api';
import { truckKeys } from '@/hooks/use-truck';

interface UserStatusEvent {
  userId: string;
  status: DriverUserStatus;
  statusUntil: string | null;
}

/**
 * Mirrors the web frontend's useUserStatusSync. Subscribes to the
 * `userStatusChanged` broadcast (sent by backend updateMe to the
 * `company-{companyId}` socket room) and patches every cached payload
 * that shows a presence dot — DM conversations, group definitions,
 * group + trip chat history, the driver's truck (which embeds the
 * manager card), and the auth store itself if it was me.
 *
 * Mounting it once in the driver layout keeps all visible avatars in
 * sync with teammates flipping their dot, no reload required.
 */
export function useUserStatusSync() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const myId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onChange = (evt: UserStatusEvent) => {
      // 1) Self — keep my own store fresh so the drawer footer dot moves
      //    even if I flipped my status from another device.
      if (evt.userId === myId) {
        const current = useAuthStore.getState().user;
        if (current) {
          setUser({
            ...current,
            status: evt.status,
            statusUntil: evt.statusUntil,
          });
        }
      }

      const patch = <T extends { id: string; status?: DriverUserStatus | null; statusUntil?: string | null }>(
        u: T,
      ): T => {
        if (u.id !== evt.userId) return u;
        return { ...u, status: evt.status, statusUntil: evt.statusUntil };
      };

      // 2) DM conversations list — patch conv.user when it matches.
      queryClient.setQueriesData<unknown>(
        { queryKey: ['conversations'] },
        (data: unknown) => {
          if (!Array.isArray(data)) return data;
          let changed = false;
          const next = data.map((conv: { user: { id: string } }) => {
            if (conv.user.id !== evt.userId) return conv;
            changed = true;
            return { ...conv, user: patch(conv.user as never) };
          });
          return changed ? next : data;
        },
      );

      // 3) DM chat user details (useChatUser query key).
      queryClient.setQueriesData<unknown>(
        { queryKey: ['chat-user', evt.userId] },
        (data: unknown) => (data ? patch(data as never) : data),
      );

      // 4) Direct messages history — patch sender on each direct message.
      queryClient.setQueriesData<unknown>(
        { queryKey: ['messages'] },
        (data: unknown) => {
          if (!Array.isArray(data)) return data;
          let changed = false;
          const next = data.map((msg: { sender?: { id: string } }) => {
            if (!msg.sender || msg.sender.id !== evt.userId) return msg;
            changed = true;
            return { ...msg, sender: patch(msg.sender as never) };
          });
          return changed ? next : data;
        },
      );

      // 5) Group definitions — patch the matching member.
      queryClient.setQueriesData<unknown>(
        { queryKey: ['manager-groups'] },
        (data: unknown) => {
          if (!Array.isArray(data)) return data;
          let changed = false;
          const next = data.map(
            (g: { managers?: { manager: { id: string } }[] }) => {
              if (!g.managers?.some((m) => m.manager.id === evt.userId)) return g;
              changed = true;
              return {
                ...g,
                managers: g.managers.map((m) =>
                  m.manager.id === evt.userId
                    ? { ...m, manager: patch(m.manager as never) }
                    : m,
                ),
              };
            },
          );
          return changed ? next : data;
        },
      );

      // 6) Group chat history — patch sender on each group message.
      queryClient.setQueriesData<unknown>(
        { queryKey: ['group-messages'] },
        (data: unknown) => {
          if (!Array.isArray(data)) return data;
          let changed = false;
          const next = data.map((msg: { sender?: { id: string } }) => {
            if (!msg.sender || msg.sender.id !== evt.userId) return msg;
            changed = true;
            return { ...msg, sender: patch(msg.sender as never) };
          });
          return changed ? next : data;
        },
      );

      // 7) Trip chat history.
      queryClient.setQueriesData<unknown>(
        { queryKey: ['trips', 'messages'] },
        (data: unknown) => {
          if (!Array.isArray(data)) return data;
          let changed = false;
          const next = data.map((msg: { sender?: { id: string } }) => {
            if (!msg.sender || msg.sender.id !== evt.userId) return msg;
            changed = true;
            return { ...msg, sender: patch(msg.sender as never) };
          });
          return changed ? next : data;
        },
      );

      // 8) Manager profile page.
      queryClient.setQueriesData<unknown>(
        { queryKey: ['manager', evt.userId] },
        (data: unknown) => (data ? patch(data as never) : data),
      );

      // 9) Driver truck — embeds the assigned manager. Patch that nested
      //    object so the drawer ManagerRow updates instantly.
      queryClient.setQueriesData<unknown>(
        { queryKey: truckKeys.mine() },
        (data: unknown) => {
          if (!data) return data;
          const truck = data as {
            manager?: { id: string } | null;
          };
          if (!truck.manager || truck.manager.id !== evt.userId) return data;
          return { ...truck, manager: patch(truck.manager as never) };
        },
      );
    };

    socket.on('userStatusChanged', onChange);
    return () => {
      socket.off('userStatusChanged', onChange);
    };
  }, [queryClient, setUser, myId]);
}
