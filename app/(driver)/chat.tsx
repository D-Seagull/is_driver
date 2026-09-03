import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fullName } from "@/lib/format";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ChatAvatar } from '@/components/chat-avatar';
import { StatusDot } from '@/components/status-dot';
import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCompanyUsers, type CompanyUser } from '@/hooks/use-company-users';
import { useConversations, type Conversation } from '@/hooks/use-direct-messages';
import { useDriverGroups, type DriverGroup } from '@/hooks/use-groups';
import { type DriverUserStatus } from '@/lib/auth-api';
import { roleBadgeIcon } from '@/lib/roles';
import { useUser } from '@/store/auth';

type Tab = 'chat' | 'groups';

// How many directory rows to reveal per page (grows on scroll-to-end).
const DIR_PAGE = 20;

export default function ChatScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  // Allow deep-linking / back-navigation to land on a specific tab (e.g.
  // returning from a group chat re-opens the Groups tab).
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(tabParam === 'groups' ? 'groups' : 'chat');
  useEffect(() => {
    if (tabParam === 'groups' || tabParam === 'chat') setTab(tabParam);
  }, [tabParam]);

  // Unread badges next to the tabs. DM count stays live via the drawer's
  // socket sync; group count refreshes on focus + after reading a group.
  const { data: conversations, refetch: refetchConvs } = useConversations();
  const { data: driverGroups, refetch: refetchGroups } = useDriverGroups();
  const dmUnread = (conversations ?? []).reduce((s, cv) => s + cv.unreadCount, 0);
  const groupUnread = (driverGroups ?? []).reduce((s, g) => s + g.unreadCount, 0);
  const isFocused = useIsFocused();
  useEffect(() => {
    if (isFocused) {
      void refetchConvs();
      void refetchGroups();
    }
  }, [isFocused, refetchConvs, refetchGroups]);

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      {/* ─── Top tab bar ───────────────────────────────────────────── */}
      <View
        style={[
          styles.tabsBar,
          {
            backgroundColor: c.card,
            borderBottomColor: c.border,
          },
        ]}
      >
        <View style={styles.tabsRow}>
          <TabButton
            label={t('nav.items.chat')}
            active={tab === 'chat'}
            onPress={() => setTab('chat')}
            activeColor={c.primary}
            inactiveColor={c.mutedForeground}
            underlineColor={c.primary}
            badge={dmUnread}
          />
          <TabButton
            label={t('nav.groups')}
            active={tab === 'groups'}
            onPress={() => setTab('groups')}
            activeColor={c.primary}
            inactiveColor={c.mutedForeground}
            underlineColor={c.primary}
            badge={groupUnread}
          />
        </View>
      </View>

      {/* ─── Tab content ───────────────────────────────────────────── */}
      <View style={styles.tabContent}>
        {tab === 'chat' ? <ChatTab /> : <GroupsTab />}
      </View>
    </View>
  );
}

// ─── Chat tab — list of DM conversations ──────────────────────────────────
function ChatTab() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const me = useUser();
  const myId = me?.id ?? '';
  const { data: conversations, isLoading } = useConversations();
  const { data: companyUsers } = useCompanyUsers();
  const [query, setQuery] = useState('');
  const [visibleDir, setVisibleDir] = useState(DIR_PAGE);

  // Reset pagination whenever the search changes so results start from the top.
  const onQueryChange = (value: string) => {
    setQuery(value);
    setVisibleDir(DIR_PAGE);
  };

  // Chat is available even before a truck is assigned — a new driver can
  // still reach their manager and other contacts through the directory.
  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (name: string, phone: string, plate: string) =>
    !q || name.includes(q) || phone.includes(q) || plate.includes(q);

  // Existing conversations — manager-tier (manager/admin/teamlead) pinned to
  // top, then most-recent first. Filtered by the search box.
  const sorted = [...(conversations ?? [])].sort((a, b) => {
    const aMgr = a.user.role !== 'DRIVER' ? 0 : 1;
    const bMgr = b.user.role !== 'DRIVER' ? 0 : 1;
    if (aMgr !== bMgr) return aMgr - bMgr;
    return (
      new Date(b.lastMessage.createdAt).getTime() -
      new Date(a.lastMessage.createdAt).getTime()
    );
  });
  const filteredConvs = sorted.filter((cv) =>
    matches(
      fullName(cv.user).toLowerCase(),
      (cv.user.phone ?? '').toLowerCase(),
      (cv.user.truckPlate ?? '').toLowerCase(),
    ),
  );

  // One combined directory of everyone you can start a chat with — managers,
  // teamleads and drivers alike (excluding yourself and anyone you already
  // have a conversation with). Manager-tier first, then alphabetical. Role is
  // shown as a label on each row instead of splitting into sections.
  const convIds = new Set((conversations ?? []).map((cv) => cv.user.id));
  const directory = (companyUsers ?? [])
    .filter(
      (u) =>
        (u.role === 'MANAGER' || u.role === 'TEAMLEAD' || u.role === 'DRIVER') &&
        u.isActive &&
        u.id !== myId &&
        !convIds.has(u.id),
    )
    .filter((u) =>
      matches(
        fullName(u).toLowerCase(),
        (u.phone ?? '').toLowerCase(),
        (u.currentTruck?.plate ?? '').toLowerCase(),
      ),
    )
    .sort((a, b) => {
      const am = a.role !== 'DRIVER' ? 0 : 1;
      const bm = b.role !== 'DRIVER' ? 0 : 1;
      if (am !== bm) return am - bm;
      return fullName(a).localeCompare(fullName(b));
    });

  // Paginate the directory — reveal DIR_PAGE rows at a time on scroll.
  const shownDir = directory.slice(0, visibleDir);

  // One flat list: conversations on top, then the directory under a single
  // "Other contacts" header — no manager/driver split.
  const rows: ChatRow[] = [];
  filteredConvs.forEach((cv) => rows.push({ type: 'conv', conv: cv }));
  if (shownDir.length > 0) {
    rows.push({ type: 'header', key: 'contacts', title: t('chatDir.otherContacts') });
    shownDir.forEach((u) => rows.push({ type: 'dir', user: u }));
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <View style={[styles.searchBox, { backgroundColor: c.muted }]}>
          <Ionicons name="search" size={16} color={c.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder={t('chatDir.searchPlaceholder')}
            placeholderTextColor={c.mutedForeground}
            style={[styles.searchInput, { color: c.foreground }]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => onQueryChange('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={c.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>
      {rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ color: c.mutedForeground }}>
            {q ? t('common.noMatches') : t('chatDir.noConversations')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) =>
            it.type === 'conv'
              ? `c:${it.conv.user.id}`
              : it.type === 'dir'
              ? `d:${it.user.id}`
              : `h:${it.key}`
          }
          renderItem={({ item }) =>
            item.type === 'conv' ? (
              <ConversationRow conv={item.conv} />
            ) : item.type === 'dir' ? (
              <DirectoryRow user={item.user} />
            ) : (
              <Text style={[styles.sectionHeader, { color: c.mutedForeground }]}>
                {item.title}
              </Text>
            )
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (visibleDir < directory.length) {
              setVisibleDir((v) => v + DIR_PAGE);
            }
          }}
        />
      )}
    </View>
  );
}

// Row model for the combined conversations + directory list.
type ChatRow =
  | { type: 'conv'; conv: Conversation }
  | { type: 'dir'; user: CompanyUser }
  | { type: 'header'; key: string; title: string };

// A contact you don't have a conversation with yet — tap to start one.
// Manager-tier rows show the role as a label; drivers show truck / phone.
function DirectoryRow({ user }: { user: CompanyUser }) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isManagerTier = user.role !== 'DRIVER';
  const roleLabel = user.role === 'TEAMLEAD' ? t('chatDir.teamlead') : t('nav.manager');
  const subtitle = isManagerTier
    ? roleLabel
    : user.currentTruck?.plate || user.phone || t('nav.driverFallback');

  return (
    <Pressable
      onPress={() => router.push(`/(driver)/dm/${user.id}` as never)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? c.muted : 'transparent' },
      ]}
    >
      <View style={styles.avatarWrap}>
        <ChatAvatar user={user} size={44} />
        {isManagerTier && (
          <View style={[styles.managerBadge, { backgroundColor: c.primary }]}>
            <Ionicons name={roleBadgeIcon(user.role)} size={9} color={c.primaryForeground} />
          </View>
        )}
        <View style={styles.presenceDot}>
          <StatusDot user={{ id: user.id, status: user.status as DriverUserStatus | null, statusUntil: user.statusUntil }} size={11} ring={c.background} />
        </View>
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
          {fullName(user) || (isManagerTier ? t('nav.manager') : t('nav.driverFallback'))}
        </Text>
        <Text style={[styles.preview, { color: c.mutedForeground }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chatbubble-outline" size={16} color={c.mutedForeground} />
    </Pressable>
  );
}

function ConversationRow({ conv }: { conv: Conversation }) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const hasUnread = conv.unreadCount > 0;
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
      <View style={styles.avatarWrap}>
        <ChatAvatar user={conv.user} size={44} />
        {isManagerTier && (
          <View style={[styles.managerBadge, { backgroundColor: c.primary }]}>
            <Ionicons name={roleBadgeIcon(conv.user.role)} size={9} color={c.primaryForeground} />
          </View>
        )}
        <View style={styles.presenceDot}>
          <StatusDot user={{ id: conv.user.id, status: conv.user.status as DriverUserStatus | null, statusUntil: conv.user.statusUntil }} size={11} ring={c.background} />
        </View>
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
            ? t('common.messageDeleted')
            : conv.lastMessage.content || t('nav.fileAttachment')}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Groups tab — list of driver groups ───────────────────────────────────
function GroupsTab() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: groups, isLoading } = useDriverGroups();

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <ScreenPlaceholder
        icon="people-outline"
        title={t('groups.empty.title')}
        subtitle={t('groups.empty.subtitle')}
      />
    );
  }

  return (
    <FlatList
      data={groups}
      keyExtractor={(g) => g.id}
      renderItem={({ item }) => <GroupRow group={item} />}
      ItemSeparatorComponent={() => (
        <View style={[styles.sep, { backgroundColor: c.border }]} />
      )}
    />
  );
}

function GroupRow({ group }: { group: DriverGroup }) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const hasUnread = group.unreadCount > 0;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/(driver)/group/[groupId]',
          params: { groupId: group.id, name: group.name },
        } as never)
      }
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
        <Ionicons name="people" size={20} color={c.primary} />
      </View>
      <View style={styles.rowText}>
        <Text
          style={[
            styles.name,
            { color: c.foreground, fontWeight: hasUnread ? '700' : '600' },
          ]}
          numberOfLines={1}
        >
          {group.name}
        </Text>
        <Text style={[styles.preview, { color: c.mutedForeground }]} numberOfLines={1}>
          {t('groups.memberCount', { count: group.memberCount })}
        </Text>
      </View>
      {hasUnread ? (
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Text style={styles.badgeText}>
            {group.unreadCount > 99 ? '99+' : group.unreadCount}
          </Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
      )}
    </Pressable>
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
  badge = 0,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  activeColor: string;
  inactiveColor: string;
  underlineColor: string;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabBtn,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.tabLabelRow}>
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
        {badge > 0 && (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </View>
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
    paddingTop: Spacing.xs,
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
  tabLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: Spacing.sm,
  },
  tabLabel: {
    fontSize: 15,
    letterSpacing: 0.2,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f87171',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  tabUnderline: {
    width: '100%',
    height: 2,
    borderTopLeftRadius: Radius.sm,
    borderTopRightRadius: Radius.sm,
  },
  tabContent: { flex: 1 },

  // Search
  searchWrap: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 38,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },

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
  // Fixed-size box that hosts the ChatAvatar plus its overlaid role badge
  // (the badge sits just outside the circle, so this wrapper must not clip).
  avatarWrap: { width: 44, height: 44 },
  managerBadge: {
    position: 'absolute',
    right: -2,
    top: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceDot: { position: 'absolute', right: -2, bottom: -2 },
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
