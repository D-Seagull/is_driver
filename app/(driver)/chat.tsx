import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { fullName, initials } from "@/lib/format";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useConversations, type Conversation } from '@/hooks/use-direct-messages';
import { useUser } from '@/store/auth';

type Tab = 'chat' | 'groups';

export default function ChatScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const user = useUser();
  const hasTruck = !!user?.currentTruck;
  const managerName = fullName(user?.manager) || 'your manager';
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ─── Top tab bar ───────────────────────────────────────────── */}
      <View
        style={[
          styles.tabsBar,
          {
            backgroundColor: c.card,
            borderBottomColor: c.border,
            paddingTop: insets.top + Spacing.xs,
          },
        ]}
      >
        <View style={styles.tabsRow}>
          <TabButton
            label="Chat"
            active={tab === 'chat'}
            onPress={() => setTab('chat')}
            activeColor={c.primary}
            inactiveColor={c.mutedForeground}
            underlineColor={c.primary}
          />
          <TabButton
            label="Groups"
            active={tab === 'groups'}
            onPress={() => setTab('groups')}
            activeColor={c.primary}
            inactiveColor={c.mutedForeground}
            underlineColor={c.primary}
          />
        </View>
      </View>

      {/* ─── Tab content ───────────────────────────────────────────── */}
      <View style={styles.tabContent}>
        {tab === 'chat' ? (
          <ChatTab hasTruck={hasTruck} managerName={managerName} />
        ) : (
          <GroupsTab />
        )}
      </View>
    </View>
  );
}

// ─── Chat tab — list of DM conversations ──────────────────────────────────
function ChatTab({
  hasTruck,
  managerName,
}: {
  hasTruck: boolean;
  managerName: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: conversations, isLoading } = useConversations();

  // No truck yet → driver can't really chat with anyone other than the
  // assigned manager (which they don't have). Keep the empty-state hint.
  if (!hasTruck) {
    return (
      <ScreenPlaceholder
        icon="chatbubble-ellipses-outline"
        title={`Chat with ${managerName}`}
        subtitle="No truck is assigned yet. Reach out to your manager — they'll set you up."
      />
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!conversations || conversations.length === 0) {
    return (
      <ScreenPlaceholder
        icon="chatbubbles-outline"
        title="No conversations yet"
        subtitle="Once a manager or another driver messages you, the chat will appear here."
      />
    );
  }

  // Manager-tier conversations (manager / admin / teamlead) pinned to top.
  const sorted = [...conversations].sort((a, b) => {
    const aMgr = a.user.role !== 'DRIVER' ? 0 : 1;
    const bMgr = b.user.role !== 'DRIVER' ? 0 : 1;
    if (aMgr !== bMgr) return aMgr - bMgr;
    return (
      new Date(b.lastMessage.createdAt).getTime() -
      new Date(a.lastMessage.createdAt).getTime()
    );
  });

  return (
    <FlatList
      data={sorted}
      keyExtractor={(item) => item.user.id}
      renderItem={({ item }) => <ConversationRow conv={item} />}
      ItemSeparatorComponent={() => (
        <View style={[styles.sep, { backgroundColor: c.border }]} />
      )}
    />
  );
}

function ConversationRow({ conv }: { conv: Conversation }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const hasUnread = conv.unreadCount > 0;
  const peerInitials = initials(conv.user);
  const isManagerTier = conv.user.role !== 'DRIVER';

  return (
    <Pressable
      onPress={() => router.push(`/(driver)/dm/${conv.user.id}` as never)}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed
            ? c.muted
            : hasUnread
            ? `${c.primary}14`
            : 'transparent',
        },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: c.muted }]}>
        <Text style={[styles.avatarText, { color: c.primary }]}>
          {peerInitials}
        </Text>
        {isManagerTier && (
          <View style={[styles.managerBadge, { backgroundColor: c.primary }]}>
            <Ionicons name="headset-outline" size={9} color={c.primaryForeground} />
          </View>
        )}
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTopLine}>
          <Text
            style={[
              styles.name,
              {
                color: c.foreground,
                fontWeight: hasUnread ? '700' : '500',
              },
            ]}
            numberOfLines={1}
          >
            {fullName(conv.user) || conv.user.role}
          </Text>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: c.primary }]}>
              <Text style={styles.badgeText}>
                {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={[styles.preview, { color: c.mutedForeground }]}
          numberOfLines={1}
        >
          {conv.lastMessage.deletedAt
            ? 'Повідомлення видалено'
            : conv.lastMessage.content || '📎 File'}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Groups tab ───────────────────────────────────────────────────────────
function GroupsTab() {
  return (
    <ScreenPlaceholder
      icon="people-outline"
      title="Groups"
      subtitle="Driver-only groups. You can add other drivers as members."
    />
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────
function TabButton({
  label,
  active,
  onPress,
  activeColor,
  inactiveColor,
  underlineColor,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
  underlineColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabBtn,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text
        style={[
          styles.tabLabel,
          {
            color: active ? activeColor : inactiveColor,
            fontWeight: active ? '600' : '500',
          },
        ]}
      >
        {label}
      </Text>
      <View
        style={[
          styles.tabUnderline,
          { backgroundColor: active ? underlineColor : 'transparent' },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabsBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingTop: Spacing.sm,
  },
  tabLabel: {
    fontSize: 15,
    letterSpacing: 0.2,
    paddingBottom: Spacing.sm,
  },
  tabUnderline: {
    width: '100%',
    height: 2,
    borderTopLeftRadius: Radius.sm,
    borderTopRightRadius: Radius.sm,
  },
  tabContent: { flex: 1 },

  // Conversation list
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '700' },
  managerBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  name: { flex: 1, fontSize: 15 },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  preview: { fontSize: 13, marginTop: 2 },
});
