import React from "react";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DrawerContentComponentProps,
  DrawerContentScrollView,
} from "@react-navigation/drawer";
import { Redirect } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Radius, Spacing, ThemeColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeMode } from "@/hooks/use-theme";
import { useDriverTruck, useTruckChangedSync } from "@/hooks/use-truck";
import { useDriverUnread, useDriverUnreadSync } from "@/hooks/use-driver-unread";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useTimezoneSync } from "@/hooks/use-timezone-sync";
import { useAppStatePresence } from "@/hooks/use-app-state-presence";
import { PushNoticeOverlay } from "@/components/push-notice-overlay";
import { useAuthStore, useUser } from "@/store/auth";

type SidebarItem = {
  name: string;
  label: string;
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
  { name: "trip", label: "Trip", renderIcon: ion("navigate-outline") },
  { name: "trips", label: "My Trips", renderIcon: ion("list-outline") },
  { name: "truck", label: "My Truck", renderIcon: mci("truck-outline") },
  { name: "documents", label: "Documents", renderIcon: ion("folder-outline") },
  { name: "chat", label: "Drivers", renderIcon: ion("chatbubbles-outline") },
  { name: "groups", label: "Groups", renderIcon: ion("people-outline") },
  { name: "alarm", label: "Alarm", renderIcon: ion("alarm-outline") },
];

export default function DriverLayout() {
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
              title: it.label,
              drawerLabel: it.label,
              drawerIcon: ({ color, size }) => it.renderIcon(color, size),
            }}
          />
        ))}
      </Drawer>
      {/* Foreground push notifications render here (Modal portals over UI). */}
      <PushNoticeOverlay />
    </>
  );
}

function DriverDrawerContent(props: DrawerContentComponentProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const currentRoute = props.state.routeNames[props.state.index];
  const { data: truck } = useDriverTruck();
  const { data: unread } = useDriverUnread();
  useDriverUnreadSync();
  useTruckChangedSync();
  usePushNotifications();
  useTimezoneSync();
  useAppStatePresence();

  const manager = truck?.manager ?? null;
  const activeTripUnread = unread?.activeTripUnread ?? 0;
  const pastTripsUnread = unread?.pastTripsUnread ?? 0;
  const totalUnread = unread?.total ?? 0;
  const unreadItems = unread?.items ?? [];

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
              <Text style={[styles.brandText, { color: c.sidebarForeground }]}>
                IS Fleet
              </Text>
              <Text style={[styles.brandSub, { color: c.mutedForeground }]}>
                Driver
              </Text>
            </View>
            {/* Bell button */}
            <Pressable
              onPress={() => setBellOpen((o) => !o)}
              hitSlop={8}
              style={({ pressed }) => [
                styles.bellBtn,
                {
                  backgroundColor: pressed || bellOpen ? c.sidebarAccent : "transparent",
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
            <View style={[styles.bellPreview, { backgroundColor: c.card, borderColor: c.sidebarBorder }]}>
              {unreadItems.length === 0 ? (
                <Text style={[styles.bellEmptyText, { color: c.mutedForeground }]}>
                  No unread messages
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                  {unreadItems.map((item) => (
                    <Pressable
                      key={item.tripId}
                      style={({ pressed }) => [
                        styles.bellItem,
                        { borderColor: c.sidebarBorder, backgroundColor: pressed ? c.sidebarAccent : "transparent" },
                      ]}
                      onPress={() => {
                        props.navigation.navigate(item.isActiveTrip ? "trip" : "trips");
                        setBellOpen(false);
                      }}
                    >
                      <View style={styles.bellItemRow}>
                        <Text style={[styles.bellItemTitle, { color: c.sidebarForeground }]} numberOfLines={1}>
                          {item.tripTitle}
                        </Text>
                        <View style={styles.bellItemBadge}>
                          <Text style={styles.bellItemBadgeText}>{item.unread}</Text>
                        </View>
                      </View>
                      {item.latestMessage && (
                        <Text style={[styles.bellItemMsg, { color: c.mutedForeground }]} numberOfLines={1}>
                          <Text style={{ fontWeight: "600" }}>{item.latestMessage.senderName}: </Text>
                          {item.latestMessage.content}
                        </Text>
                      )}
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
            it.name === "trip" ? activeTripUnread :
            it.name === "trips" ? pastTripsUnread : 0;
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
              <View style={styles.itemIconSlot}>
                {it.renderIcon(tint, 22)}
              </View>
              <Text
                style={[
                  styles.navLabel,
                  { color: tint, fontWeight: focused ? "600" : "500" },
                ]}
              >
                {it.label}
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
              name: manager.name ?? "Manager",
              phone: manager.phone ?? "",
              avatar: manager.avatar,
            }}
            colors={c}
          />
        )}
      </View>
    </View>
  );
}

function DriverFooter({ colors: c }: { colors: ThemeColors }) {
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const driver = {
    name: user?.name ?? "Driver",
    subtitle: user?.phone ?? "",
    avatar: null as string | null,
  };
  return (
    <View style={styles.driverRow}>
      <View style={[styles.avatarLg, { backgroundColor: c.muted }]}>
        <Ionicons name="person" size={22} color={c.mutedForeground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.driverName, { color: c.sidebarForeground }]}
          numberOfLines={1}
        >
          {driver.name}
        </Text>
        {driver.subtitle ? (
          <Text
            style={[styles.driverSub, { color: c.mutedForeground }]}
            numberOfLines={1}
          >
            {driver.subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={logout}
        hitSlop={8}
        accessibilityLabel="Log out"
        style={({ pressed }) => [
          styles.logoutBtn,
          {
            backgroundColor: pressed ? c.sidebarAccent : "transparent",
            borderRadius: Radius.sm,
          },
        ]}
      >
        <Ionicons name="log-out-outline" size={20} color={c.mutedForeground} />
      </Pressable>
    </View>
  );
}

function ThemeToggleButton({ colors: c }: { colors: ThemeColors }) {
  const { resolved, toggle } = useThemeMode();
  const isDark = resolved === "dark";
  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityLabel="Toggle theme"
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
  person: { name: string; phone: string; avatar: string | null };
  colors: ThemeColors;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.managerRow,
        {
          backgroundColor: pressed ? c.sidebarAccent : "transparent",
          borderRadius: Radius.sm,
        },
      ]}
    >
      <View style={[styles.avatarSm, { backgroundColor: c.muted }]}>
        {person.avatar ? (
          <Image source={{ uri: person.avatar }} style={styles.avatarImg} />
        ) : (
          <Ionicons
            name="headset-outline"
            size={12}
            color={c.mutedForeground}
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.managerLabel, { color: c.mutedForeground }]}
          numberOfLines={1}
        >
          Manager
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
      <Ionicons
        name="chatbubble-ellipses-outline"
        size={14}
        color={c.mutedForeground}
      />
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
    width: 36, height: 36,
    alignItems: "center", justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    position: "relative",
  },
  bellBadge: {
    position: "absolute", top: 2, right: 2,
    minWidth: 14, height: 14, borderRadius: 7,
    backgroundColor: "#f87171",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 2,
  },
  bellBadgeText: { color: "#fff", fontSize: 8, fontWeight: "700" },
  // Bell preview panel
  bellPreview: {
    marginTop: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  bellEmptyText: { fontSize: 13, textAlign: "center", paddingVertical: Spacing.md },
  bellItem: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  bellItemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  bellItemTitle: { flex: 1, fontSize: 13, fontWeight: "600" },
  bellItemBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#f87171",
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
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
  avatarLg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
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
