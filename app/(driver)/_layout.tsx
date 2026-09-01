import { PresenceStatusSheet } from "@/components/presence-status-sheet";
import { StatusDot } from "@/components/status-dot";
import { fullName, initials } from "@/lib/format";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DrawerContentComponentProps,
  DrawerContentScrollView,
  useDrawerStatus,
} from "@react-navigation/drawer";
import { Redirect, router } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { Image as ExpoImage } from "expo-image";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NextTripOverlay } from "@/components/next-trip-overlay";
import { NotificationBell } from "@/components/notification-bell";
import { PushNoticeOverlay } from "@/components/push-notice-overlay";
import { Colors, Radius, Spacing, ThemeColors } from "@/constants/theme";
import { useAppStatePresence } from "@/hooks/use-app-state-presence";
import { useChatAlerts } from "@/hooks/use-chat-alerts";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useConversations, useDmUnreadSync } from "@/hooks/use-direct-messages";
import {
  useDriverUnread,
  useDriverUnreadSync,
} from "@/hooks/use-driver-unread";
import { useDriverGroups, useGroupUnreadSync } from "@/hooks/use-groups";
import { usePresenceSync } from "@/hooks/use-presence";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useThemeMode } from "@/hooks/use-theme";
import { useTimezoneSync } from "@/hooks/use-timezone-sync";
import { useTripsSync } from "@/hooks/use-trips";
import { useDriverTruck, useTruckChangedSync } from "@/hooks/use-truck";
import { useUserStatusSync } from "@/hooks/use-user-status-sync";
import { systemMessageText } from "@/lib/system-message";
import { useAuthStore, useUser } from "@/store/auth";

type SidebarItem = {
  // `name` doubles as the i18n key under nav.items.* for the label.
  name: string;
  renderIcon: (color: string, size: number) => React.ReactNode;
};

// These are render-prop factories, not components — display-name doesn't apply.
const ion =
  (n: React.ComponentProps<typeof Ionicons>["name"]) =>
  // eslint-disable-next-line react/display-name
  (color: string, size: number) => (
    <Ionicons name={n} size={size} color={color} />
  );

const mci =
  (n: React.ComponentProps<typeof MaterialCommunityIcons>["name"]) =>
  // eslint-disable-next-line react/display-name
  (color: string, size: number) => (
    <MaterialCommunityIcons name={n} size={size} color={color} />
  );

const ITEMS: SidebarItem[] = [
  { name: "trip", renderIcon: ion("navigate-outline") },
  { name: "trips", renderIcon: ion("list-outline") },
  { name: "truck", renderIcon: mci("truck-outline") },
  { name: "documents", renderIcon: ion("folder-outline") },
  { name: "chat", renderIcon: ion("chatbubbles-outline") },
  { name: "alarm", renderIcon: ion("alarm-outline") },
];

export default function DriverLayout() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const token = useAuthStore((s) => s.token);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // Bounce out as soon as the user logs out (or arrives unauthenticated).
  if (isHydrated && !token) {
    return <Redirect href="/(auth)/phone" />;
  }

  return (
    <>
      <Drawer
        drawerContent={(props) => <DriverDrawerContent {...props} />}
        screenOptions={{
          headerStyle: { backgroundColor: c.background },
          headerTintColor: c.foreground,
          headerTitleStyle: { fontWeight: "600" },
          // Standardised notification bell in the header of every drawer
          // screen, so new messages are always visible.
          headerRight: () => <NotificationBell colors={c} />,
          headerRightContainerStyle: { paddingRight: Spacing.md },
          sceneStyle: { backgroundColor: c.background },
          drawerStyle: { backgroundColor: c.sidebar, width: 300 },
          drawerActiveTintColor: c.sidebarPrimary,
          drawerInactiveTintColor: c.sidebarForeground,
          drawerActiveBackgroundColor: c.sidebarAccent,
        }}
      >
        {ITEMS.map((it) => (
          <Drawer.Screen
            key={it.name}
            name={it.name}
            options={{
              title: t(`nav.items.${it.name}`),
              drawerLabel: t(`nav.items.${it.name}`),
              drawerIcon: ({ color, size }) => it.renderIcon(color, size),
            }}
            listeners={
              it.name === "trip"
                ? ({ navigation }) => ({
                    // The "Trip" tab must always land on the driver's ACTIVE
                    // trip — drop any tripId left over from opening a specific
                    // trip via the Trips list / "next trip" strip.
                    drawerItemPress: (e) => {
                      e.preventDefault();
                      navigation.navigate("trip", { tripId: undefined });
                      navigation.closeDrawer();
                    },
                  })
                : undefined
            }
          />
        ))}
        {/* Manager card — opened by tapping the manager row in the sidebar
            or the manager block on the Truck screen, not from the drawer. */}
        <Drawer.Screen
          name="manager"
          options={{
            title: t("nav.manager"),
            drawerItemStyle: { display: "none" },
          }}
        />
        {/* Groups — rendered as a tab inside Chat; the standalone route is
            kept for deep links but hidden from the drawer. */}
        <Drawer.Screen
          name="groups"
          options={{
            title: t("nav.groups"),
            drawerItemStyle: { display: "none" },
          }}
        />
        {/* Settings — pushed from the gear icon in the drawer footer.
            Holds profile editing, language and logout in one place. */}
        <Drawer.Screen
          name="settings"
          options={{
            title: t("settings.title"),
            drawerItemStyle: { display: "none" },
          }}
        />
        {/* DM — direct-message chat with a specific user. Pushed via
            router.push("/(driver)/dm/<userId>") from the chat tab; hidden
            from the drawer and has its own stack layout. */}
        <Drawer.Screen
          name="dm"
          options={{
            drawerItemStyle: { display: "none" },
            headerShown: false,
          }}
        />
        {/* Group chat — pushed via router.push("/(driver)/group/<groupId>")
            from the Groups tab; hidden from the drawer, own stack layout. */}
        <Drawer.Screen
          name="group"
          options={{
            drawerItemStyle: { display: "none" },
            headerShown: false,
          }}
        />
      </Drawer>
      {/* Foreground push notifications render here (Modal portals over UI). */}
      <PushNoticeOverlay />
      {/* Hand-off popup when the current trip is delivered and a next order
          is queued — announces it with OK → ACCEPTED + opens it. */}
      <NextTripOverlay />
    </>
  );
}

function DriverDrawerContent(props: DrawerContentComponentProps) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const currentRoute = props.state.routeNames[props.state.index];
  const { data: truck } = useDriverTruck();
  const { data: unread, refetch: refetchUnread } = useDriverUnread();
  const { data: conversations, refetch: refetchConversations } =
    useConversations();
  const { data: driverGroups, refetch: refetchGroupUnread } = useDriverGroups();
  useDriverUnreadSync();
  useDmUnreadSync();
  useGroupUnreadSync();
  useTruckChangedSync();
  useTripsSync();
  useChatAlerts();

  // The socket syncs keep counts live, but also hard-refresh both unread
  // sources every time the drawer opens — so the bell always reflects the
  // latest state the moment the user looks at it.
  const drawerStatus = useDrawerStatus();
  React.useEffect(() => {
    if (drawerStatus === "open") {
      void refetchUnread();
      void refetchConversations();
      void refetchGroupUnread();
    }
  }, [drawerStatus, refetchUnread, refetchConversations, refetchGroupUnread]);
  usePushNotifications();
  useTimezoneSync();
  useAppStatePresence();
  // Live presence dots — patches every cached payload when a teammate
  // flips their Online/Busy/Sleep so the drawer / chat avatars update
  // without restarting the app.
  useUserStatusSync();
  // Live online/offline set — backend pushes connect/disconnect events
  // so StatusDot can flip teammates to OFFLINE when they close the app.
  usePresenceSync();

  const manager = truck?.manager ?? null;
  const activeTripUnread = unread?.activeTripUnread ?? 0;
  const pastTripsUnread = unread?.pastTripsUnread ?? 0;
  const tripUnreadTotal = unread?.total ?? 0;
  const unreadItems = unread?.items ?? [];

  // Direct-chat unread — derived from the conversations list (unreadCount per
  // peer). Feeds both the bell and the Chat nav-item badge.
  const dmItems = (conversations ?? []).filter((c) => c.unreadCount > 0);
  const dmUnreadTotal = dmItems.reduce((s, c) => s + c.unreadCount, 0);

  // Group unread — driver groups carry per-group unreadCount (docs included).
  const groupItems = (driverGroups ?? []).filter((g) => g.unreadCount > 0);
  const groupUnreadTotal = groupItems.reduce((s, g) => s + g.unreadCount, 0);

  const totalUnread = tripUnreadTotal + dmUnreadTotal + groupUnreadTotal;

  const [bellOpen, setBellOpen] = React.useState(false);

  return (
    <View style={[styles.container, { backgroundColor: c.sidebar }]}>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + Spacing.sm, borderColor: c.sidebarBorder },
        ]}
      >
        {/* ── Brand row ── */}
        <View style={[styles.brand, { borderBottomColor: c.sidebarBorder }]}>
          <View style={styles.brandRow}>
            <View style={{ flex: 1 }}>
              <Image
                source={
                  scheme === "dark"
                    ? require("../../assets/images/is_logo__white.png")
                    : require("../../assets/images/IS_logo.png")
                }
                style={styles.brandLogo}
                resizeMode="contain"
              />
            </View>
            {/* Bell button */}
            <Pressable
              onPress={() => setBellOpen((o) => !o)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.bellBtn,
                {
                  backgroundColor:
                    pressed || bellOpen ? c.sidebarAccent : "transparent",
                  borderColor: c.sidebarBorder,
                  borderRadius: Radius.md,
                },
              ]}
            >
              <Ionicons
                name="notifications-outline"
                size={18}
                color={c.sidebarForeground}
              />
              {totalUnread > 0 && (
                <View style={styles.bellBadge}>
                  <Text style={styles.bellBadgeText}>
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </Text>
                </View>
              )}
            </Pressable>
            <ThemeToggleButton colors={c} />
          </View>

          {/* ── Bell preview panel ── */}
          {bellOpen && (
            <View
              style={[
                styles.bellPreview,
                { backgroundColor: c.card, borderColor: c.sidebarBorder },
              ]}
            >
              {unreadItems.length === 0 &&
              dmItems.length === 0 &&
              groupItems.length === 0 ? (
                <Text
                  style={[styles.bellEmptyText, { color: c.mutedForeground }]}
                >
                  {t("nav.noUnread")}
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                  {unreadItems.map((item) => (
                    <Pressable
                      key={item.tripId}
                      style={({ pressed }) => [
                        styles.bellItem,
                        {
                          borderColor: c.sidebarBorder,
                          backgroundColor: pressed
                            ? c.sidebarAccent
                            : "transparent",
                        },
                      ]}
                      onPress={() => {
                        // Active trip → open the Trip tab on the ACTIVE trip
                        // (clear any stale tripId). Others → the Trips list.
                        if (item.isActiveTrip) {
                          props.navigation.navigate("trip", {
                            tripId: undefined,
                          });
                        } else {
                          props.navigation.navigate("trips");
                        }
                        setBellOpen(false);
                      }}
                    >
                      <View style={styles.bellItemRow}>
                        <Text
                          style={[
                            styles.bellItemTitle,
                            { color: c.sidebarForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {item.tripTitle}
                        </Text>
                        <View style={styles.bellItemBadge}>
                          <Text style={styles.bellItemBadgeText}>
                            {item.unread}
                          </Text>
                        </View>
                      </View>
                      {item.latestMessage && (
                        <Text
                          style={[
                            styles.bellItemMsg,
                            { color: c.mutedForeground },
                          ]}
                          numberOfLines={1}
                        >
                          <Text style={{ fontWeight: "600" }}>
                            {item.latestMessage.senderName}:{" "}
                          </Text>
                          {systemMessageText(item.latestMessage.content, t)}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                  {dmItems.map((conv) => (
                    <Pressable
                      key={`dm-${conv.user.id}`}
                      style={({ pressed }) => [
                        styles.bellItem,
                        {
                          borderColor: c.sidebarBorder,
                          backgroundColor: pressed
                            ? c.sidebarAccent
                            : "transparent",
                        },
                      ]}
                      onPress={() => {
                        router.push(`/(driver)/dm/${conv.user.id}` as never);
                        setBellOpen(false);
                      }}
                    >
                      <View style={styles.bellItemRow}>
                        <Text
                          style={[
                            styles.bellItemTitle,
                            { color: c.sidebarForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {fullName(conv.user) || t("nav.chatFallback")}
                        </Text>
                        <View style={styles.bellItemBadge}>
                          <Text style={styles.bellItemBadgeText}>
                            {conv.unreadCount}
                          </Text>
                        </View>
                      </View>
                      <Text
                        style={[
                          styles.bellItemMsg,
                          { color: c.mutedForeground },
                        ]}
                        numberOfLines={1}
                      >
                        {conv.lastMessage?.deletedAt
                          ? t("common.messageDeleted")
                          : conv.lastMessage?.content ||
                            t("nav.fileAttachment")}
                      </Text>
                    </Pressable>
                  ))}
                  {groupItems.map((g) => (
                    <Pressable
                      key={`group-${g.id}`}
                      style={({ pressed }) => [
                        styles.bellItem,
                        {
                          borderColor: c.sidebarBorder,
                          backgroundColor: pressed
                            ? c.sidebarAccent
                            : "transparent",
                        },
                      ]}
                      onPress={() => {
                        router.push(`/(driver)/group/${g.id}` as never);
                        setBellOpen(false);
                      }}
                    >
                      <View style={styles.bellItemRow}>
                        <Text
                          style={[
                            styles.bellItemTitle,
                            { color: c.sidebarForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {g.name}
                        </Text>
                        <View style={styles.bellItemBadge}>
                          <Text style={styles.bellItemBadgeText}>
                            {g.unreadCount}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </View>

        {/* ── Nav items (custom, for badge support) ── */}
        {ITEMS.map((it) => {
          const focused = currentRoute === it.name;
          const tint = focused ? c.sidebarPrimary : c.sidebarForeground;
          const badge =
            it.name === "trip"
              ? activeTripUnread
              : it.name === "trips"
                ? pastTripsUnread
                : it.name === "chat"
                  ? dmUnreadTotal + groupUnreadTotal
                  : 0;
          return (
            <Pressable
              key={it.name}
              onPress={() => props.navigation.navigate(it.name)}
              style={({ pressed }) => [
                styles.navItem,
                {
                  borderRadius: Radius.md,
                  marginHorizontal: Spacing.sm,
                  marginVertical: 2,
                  backgroundColor: focused
                    ? c.sidebarAccent
                    : pressed
                      ? c.sidebarAccent + "80"
                      : "transparent",
                },
              ]}
            >
              <View style={styles.itemIconSlot}>{it.renderIcon(tint, 22)}</View>
              <Text
                style={[
                  styles.navLabel,
                  { color: tint, fontWeight: focused ? "600" : "500" },
                ]}
              >
                {t(`nav.items.${it.name}`)}
              </Text>
              {badge > 0 && (
                <View style={styles.itemBadge}>
                  <Text style={styles.itemBadgeText}>{badge}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </DrawerContentScrollView>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: c.sidebarBorder,
            // Push the bottom of the drawer above the Android nav bar
            // (gesture pill / 3-button) and the iOS home indicator.
            paddingBottom: Math.max(insets.bottom, Spacing.md),
          },
        ]}
      >
        <DriverFooter colors={c} />
        {manager && (
          <ManagerRow
            person={{
              id: manager.id,
              name: fullName(manager) || t("nav.manager"),
              phone: manager.phone ?? "",
              avatar: manager.avatar,
              status: manager.status ?? null,
              statusUntil: manager.statusUntil ?? null,
            }}
            colors={c}
          />
        )}
      </View>
    </View>
  );
}

function DriverFooter({ colors: c }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const user = useUser();
  const name = fullName(user) || t("nav.driverFallback");
  const subtitle = user?.phone ?? "";
  const peerInitials = initials(user);
  const [statusOpen, setStatusOpen] = React.useState(false);

  return (
    <>
      <View style={styles.driverRow}>
        {/* Tap on the avatar / name area opens the presence picker
            directly — full settings still live behind the gear icon. */}
        <Pressable
          onPress={() => setStatusOpen(true)}
          style={({ pressed }) => [
            styles.driverPressable,
            { backgroundColor: pressed ? c.sidebarAccent : "transparent" },
          ]}
        >
          <View style={{ position: "relative" }}>
            <View style={[styles.avatarLg, { backgroundColor: c.muted }]}>
              {user?.avatar ? (
                <ExpoImage
                  source={{ uri: user.avatar }}
                  style={styles.avatarLgImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <Text
                  style={[styles.avatarLgText, { color: c.mutedForeground }]}
                >
                  {peerInitials}
                </Text>
              )}
            </View>
            <View style={styles.statusDotAnchor}>
              <StatusDot user={user} isOnline ring={c.sidebar} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.driverName, { color: c.sidebarForeground }]}
              numberOfLines={1}
            >
              {name}
            </Text>
            {subtitle ? (
              <Text
                style={[styles.driverSub, { color: c.mutedForeground }]}
                numberOfLines={1}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => router.push("/(driver)/settings")}
          hitSlop={8}
          accessibilityLabel={t("nav.openSettings")}
          style={({ pressed }) => [
            styles.logoutBtn,
            {
              backgroundColor: pressed ? c.sidebarAccent : "transparent",
              borderRadius: Radius.sm,
            },
          ]}
        >
          <Ionicons
            name="settings-outline"
            size={20}
            color={c.mutedForeground}
          />
        </Pressable>
      </View>
      <PresenceStatusSheet
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
      />
    </>
  );
}

function ThemeToggleButton({ colors: c }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const { resolved, toggle } = useThemeMode();
  const isDark = resolved === "dark";
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityLabel={t("nav.toggleTheme")}
      style={({ pressed }) => [
        styles.themeBtn,
        {
          backgroundColor: pressed ? c.sidebarAccent : "transparent",
          borderColor: c.sidebarBorder,
          borderRadius: Radius.md,
        },
      ]}
    >
      <Ionicons
        name={isDark ? "moon-outline" : "sunny-outline"}
        size={18}
        color={c.sidebarForeground}
      />
    </Pressable>
  );
}

function ManagerRow({
  person,
  colors: c,
}: {
  person: {
    id: string;
    name: string;
    phone: string;
    avatar: string | null;
    status: "ONLINE" | "BUSY" | "AWAY" | "SLEEP" | "VACATION" | null;
    statusUntil: string | null;
  };
  colors: ThemeColors;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={() => router.push("/(driver)/manager")}
      style={({ pressed }) => [
        styles.managerRow,
        {
          backgroundColor: pressed ? c.sidebarAccent : "transparent",
          borderRadius: Radius.sm,
        },
      ]}
    >
      <View style={{ position: "relative" }}>
        <View style={[styles.avatarSm, { backgroundColor: c.muted }]}>
          {person.avatar ? (
            <ExpoImage source={{ uri: person.avatar }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Ionicons
              name="headset-outline"
              size={12}
              color={c.mutedForeground}
            />
          )}
        </View>
        <View style={styles.statusDotAnchor}>
          <StatusDot user={person} size={8} ring={c.sidebar} />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.managerLabel, { color: c.mutedForeground }]}
          numberOfLines={1}
        >
          {t("nav.manager")}
        </Text>
        <Text
          style={[styles.managerName, { color: c.sidebarForeground }]}
          numberOfLines={1}
        >
          {person.name}
        </Text>
        {person.phone ? (
          <Text
            style={[styles.managerPhone, { color: c.mutedForeground }]}
            numberOfLines={1}
          >
            {person.phone}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => router.push(`/(driver)/dm/${person.id}` as never)}
        hitSlop={8}
        accessibilityLabel={t("nav.messageManager")}
        style={({ pressed }) => [
          styles.managerChatBtn,
          {
            backgroundColor: pressed ? c.sidebarAccent : "transparent",
            borderRadius: Radius.sm,
          },
        ]}
      >
        <Ionicons
          name="chatbubble-ellipses-outline"
          size={20}
          color={c.mutedForeground}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {},
  brand: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  brandText: { fontSize: 18, fontWeight: "700" },
  brandLogo: { height: 50, aspectRatio: 612 / 408, alignSelf: "flex-start" },
  brandSub: { fontSize: 12, marginTop: 2 },
  themeBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  logoutBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  managerChatBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  itemIconSlot: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  // Custom nav item (replaces DrawerItem for badge support)
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  navLabel: { flex: 1, fontSize: 15 },
  itemBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#f87171",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  itemBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  // Bell button
  bellBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  bellBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#f87171",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  bellBadgeText: { color: "#fff", fontSize: 8, fontWeight: "700" },
  // Bell preview panel
  bellPreview: {
    marginTop: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  bellEmptyText: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: Spacing.md,
  },
  bellItem: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  bellItemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  bellItemTitle: { flex: 1, fontSize: 13, fontWeight: "600" },
  bellItemBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#f87171",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  bellItemBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  bellItemMsg: { fontSize: 12 },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },

  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  driverPressable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginHorizontal: -6,
    borderRadius: Radius.sm,
  },
  avatarLg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarLgImg: { width: "100%", height: "100%" },
  statusDotAnchor: {
    position: "absolute",
    right: -2,
    bottom: -2,
  },
  avatarLgText: { fontSize: 15, fontWeight: "700" },
  avatarBusy: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  driverName: { fontSize: 15, fontWeight: "700" },
  driverSub: { fontSize: 12, marginTop: 2 },

  managerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 6,
  },
  avatarSm: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  managerLabel: {
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  managerName: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  managerPhone: { fontSize: 11, marginTop: 1 },
});
