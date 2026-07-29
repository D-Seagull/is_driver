import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, ThemeColors } from '@/constants/theme';
import { useConversations } from '@/hooks/use-direct-messages';
import { useDriverUnread } from '@/hooks/use-driver-unread';
import { fullName } from '@/lib/format';

/**
 * Notification bell shared by the sidebar and the trip header. Shows total
 * unread (trip chats + direct chats), and opens a dropdown listing each
 * unread conversation. Tapping an item jumps to that chat.
 *
 * Live counts come from the socket syncs mounted in the drawer; opening the
 * panel also hard-refreshes both sources so it's always current.
 */
export function NotificationBell({ colors: c }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data: unread, refetch: refetchUnread } = useDriverUnread();
  const { data: conversations, refetch: refetchConversations } = useConversations();
  const [open, setOpen] = useState(false);

  const unreadItems = unread?.items ?? [];
  const dmItems = (conversations ?? []).filter((cv) => cv.unreadCount > 0);
  const dmTotal = dmItems.reduce((s, cv) => s + cv.unreadCount, 0);
  const total = (unread?.total ?? 0) + dmTotal;
  const isEmpty = unreadItems.length === 0 && dmItems.length === 0;

  const openPanel = () => {
    void refetchUnread();
    void refetchConversations();
    setOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={openPanel}
        hitSlop={8}
        style={({ pressed }) => [
          styles.bellBtn,
          {
            backgroundColor: pressed ? c.sidebarAccent : 'transparent',
            borderColor: c.sidebarBorder,
            borderRadius: Radius.md,
          },
        ]}
      >
        <Ionicons name="notifications-outline" size={18} color={c.foreground} />
        {total > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{total > 99 ? '99+' : total}</Text>
          </View>
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View
            style={[
              styles.panel,
              {
                top: insets.top + 52,
                backgroundColor: c.card,
                borderColor: c.sidebarBorder,
              },
            ]}
          >
            {isEmpty ? (
              <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                {t('nav.noUnread')}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
                {unreadItems.map((item) => (
                  <Pressable
                    key={`trip-${item.tripId}`}
                    style={({ pressed }) => [
                      styles.item,
                      { borderColor: c.sidebarBorder, backgroundColor: pressed ? c.sidebarAccent : 'transparent' },
                    ]}
                    onPress={() => {
                      setOpen(false);
                      if (item.isActiveTrip) {
                        router.navigate('/(driver)/trip');
                      } else {
                        router.push({
                          pathname: '/(driver)/trip',
                          params: { tripId: item.tripId },
                        });
                      }
                    }}
                  >
                    <View style={styles.itemRow}>
                      <Text style={[styles.itemTitle, { color: c.foreground }]} numberOfLines={1}>
                        {item.tripTitle}
                      </Text>
                      <View style={styles.itemBadge}>
                        <Text style={styles.itemBadgeText}>{item.unread}</Text>
                      </View>
                    </View>
                    {item.latestMessage && (
                      <Text style={[styles.itemMsg, { color: c.mutedForeground }]} numberOfLines={1}>
                        <Text style={{ fontWeight: '600' }}>{item.latestMessage.senderName}: </Text>
                        {item.latestMessage.content}
                      </Text>
                    )}
                  </Pressable>
                ))}
                {dmItems.map((conv) => (
                  <Pressable
                    key={`dm-${conv.user.id}`}
                    style={({ pressed }) => [
                      styles.item,
                      { borderColor: c.sidebarBorder, backgroundColor: pressed ? c.sidebarAccent : 'transparent' },
                    ]}
                    onPress={() => {
                      setOpen(false);
                      router.push(`/(driver)/dm/${conv.user.id}` as never);
                    }}
                  >
                    <View style={styles.itemRow}>
                      <Text style={[styles.itemTitle, { color: c.foreground }]} numberOfLines={1}>
                        {fullName(conv.user) || t('nav.chatFallback')}
                      </Text>
                      <View style={styles.itemBadge}>
                        <Text style={styles.itemBadgeText}>{conv.unreadCount}</Text>
                      </View>
                    </View>
                    <Text style={[styles.itemMsg, { color: c.mutedForeground }]} numberOfLines={1}>
                      {conv.lastMessage?.deletedAt
                        ? t('common.messageDeleted')
                        : conv.lastMessage?.content || t('nav.fileAttachment')}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#f87171',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  badgeText: { color: '#fff', fontSize: 8, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'transparent' },
  panel: {
    position: 'absolute',
    right: Spacing.md,
    width: 280,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    overflow: 'hidden',
    // Float above the header.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: Spacing.md },
  item: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemTitle: { flex: 1, fontSize: 13, fontWeight: '600' },
  itemBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f87171',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  itemBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  itemMsg: { fontSize: 12 },
});
