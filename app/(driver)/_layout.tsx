import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItem,
} from "@react-navigation/drawer";
import { Redirect } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Radius, Spacing, ThemeColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeMode } from "@/hooks/use-theme";
import { useDriverTruck } from "@/hooks/use-truck";
import { useAuthStore, useUser } from "@/store/auth";

type SidebarItem = {
  name: string;
  label: string;
  renderIcon: (color: string, size: number) => React.ReactNode;
};

const ion =
  (n: React.ComponentProps<typeof Ionicons>["name"]) =>
  (color: string, size: number) => (
    <Ionicons name={n} size={size} color={color} />
  );

const mci =
  (n: React.ComponentProps<typeof MaterialCommunityIcons>["name"]) =>
  (color: string, size: number) => (
    <MaterialCommunityIcons name={n} size={size} color={color} />
  );

const ITEMS: SidebarItem[] = [
  { name: "trip", label: "Trip", renderIcon: ion("navigate-outline") },
  { name: "trips", label: "My Trips", renderIcon: ion("list-outline") },
  { name: "truck", label: "My Truck", renderIcon: mci("truck-outline") },
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
  );
}

function DriverDrawerContent(props: DrawerContentComponentProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const currentRoute = props.state.routeNames[props.state.index];
  const { data: truck } = useDriverTruck();

  const dispatcher = truck?.dispatcher ?? null;

  return (
    <View style={[styles.container, { backgroundColor: c.sidebar }]}>
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + Spacing.sm, borderColor: c.sidebarBorder },
        ]}
      >
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
            <ThemeToggleButton colors={c} />
          </View>
        </View>

        {ITEMS.map((it) => {
          const focused = currentRoute === it.name;
          const tint = focused ? c.sidebarPrimary : c.sidebarForeground;
          return (
            <DrawerItem
              key={it.name}
              label={it.label}
              focused={focused}
              // Render icon inside a fixed-width slot so labels line up,
              // and provide visible spacing between icon and text.
              icon={({ size }) => (
                <View style={styles.itemIconSlot}>
                  {it.renderIcon(tint, size)}
                </View>
              )}
              labelStyle={{
                color: tint,
                fontWeight: focused ? "600" : "500",
                fontSize: 15,
                marginLeft: Spacing.sm,
              }}
              style={{
                borderRadius: Radius.md,
                backgroundColor: focused ? c.sidebarAccent : "transparent",
                marginHorizontal: Spacing.sm,
                marginVertical: 2,
                paddingVertical: 2,
              }}
              onPress={() => props.navigation.navigate(it.name)}
            />
          );
        })}
      </DrawerContentScrollView>

      <View style={[styles.footer, { borderTopColor: c.sidebarBorder }]}>
        <DriverFooter colors={c} />
        {dispatcher && (
          <DispatcherRow
            person={{
              name: dispatcher.name ?? "Dispatcher",
              phone: dispatcher.phone ?? "",
              avatar: dispatcher.avatar,
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
        <Ionicons
          name="log-out-outline"
          size={20}
          color={c.mutedForeground}
        />
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

function DispatcherRow({
  person,
  colors: c,
}: {
  person: { name: string; phone: string; avatar: string | null };
  colors: ThemeColors;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.dispatcherRow,
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
          style={[styles.dispatcherLabel, { color: c.mutedForeground }]}
          numberOfLines={1}
        >
          Dispatcher
        </Text>
        <Text
          style={[styles.dispatcherName, { color: c.sidebarForeground }]}
          numberOfLines={1}
        >
          {person.name}
        </Text>
        {person.phone ? (
          <Text
            style={[styles.dispatcherPhone, { color: c.mutedForeground }]}
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

  dispatcherRow: {
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
  dispatcherLabel: {
    fontSize: 10,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dispatcherName: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  dispatcherPhone: { fontSize: 11, marginTop: 1 },
});
