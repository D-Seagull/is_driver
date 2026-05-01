import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { StatusPicker } from '@/components/status-picker';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { TripStatus } from '@/constants/trip-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useActiveTrip, useUpdateMyTripStatus } from '@/hooks/use-trips';
import { Trip } from '@/lib/types';
import { useUser } from '@/store/auth';

export default function TripScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const user = useUser();

  const { data: trip, isLoading, isRefetching, refetch } = useActiveTrip();
  const updateStatus = useUpdateMyTripStatus();

  const handleStatusChange = (next: TripStatus) => {
    if (!trip) return;
    updateStatus.mutate({ id: trip.id, status: next });
  };

  // Header data: prefer the trip's own truck/driver, fall back to the
  // logged-in user (in case there's no active trip yet).
  const truckPlate =
    trip?.truck?.plate ?? user?.currentTruck?.plate ?? '—';
  const driverName = trip?.driver?.name ?? user?.name ?? 'Driver';
  const status: TripStatus = trip?.status ?? 'ASSIGNED';

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <TripHeader
        truck={truckPlate}
        driver={driverName}
        status={status}
        onChangeStatus={handleStatusChange}
        canEditStatus={!!trip}
      />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : !trip ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
        >
          <ScreenPlaceholder
            icon="document-text-outline"
            title="No active trip"
            subtitle="When your dispatcher assigns a trip, it'll show up here. Pull down to refresh."
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
        >
          <TripInfoCard trip={trip} />
          <ScreenPlaceholder
            icon="chatbubble-ellipses-outline"
            title="Trip chat"
            subtitle="Real-time chat for this trip lands here next."
          />
        </ScrollView>
      )}
    </View>
  );
}

function TripInfoCard({ trip }: { trip: Trip }) {
  const c = Colors[useColorScheme() ?? 'light'];
  const loading = trip.stops.filter((s) => s.type === 'LOADING');
  const unloading = trip.stops.filter((s) => s.type === 'UNLOADING');
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderRadius: Radius.lg,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: c.foreground }]} numberOfLines={2}>
          {trip.title}
        </Text>
        {trip.orderNumber ? (
          <Text style={[styles.cardSub, { color: c.mutedForeground }]}>
            #{trip.orderNumber}
          </Text>
        ) : null}
      </View>

      {loading.length > 0 && (
        <StopsBlock label="Loading" color="#10B981" stops={loading} />
      )}
      {unloading.length > 0 && (
        <StopsBlock label="Unloading" color="#EF4444" stops={unloading} />
      )}

      {trip.notes ? (
        <View
          style={[
            styles.notes,
            { borderTopColor: c.border },
          ]}
        >
          <Text style={[styles.notesText, { color: c.mutedForeground }]}>
            {trip.notes}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function StopsBlock({
  label,
  color,
  stops,
}: {
  label: string;
  color: string;
  stops: Trip['stops'];
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={styles.stopsBlock}>
      <View style={styles.stopsHeader}>
        <Ionicons name="location-outline" size={14} color={color} />
        <Text style={[styles.stopsLabel, { color }]}>
          {label} ({stops.length})
        </Text>
      </View>
      {stops.map((s, i) => (
        <View key={s.id} style={styles.stopRow}>
          <Text style={[styles.stopIndex, { color: c.mutedForeground }]}>
            {i + 1}.
          </Text>
          <Text style={[styles.stopAddress, { color: c.foreground }]} numberOfLines={3}>
            {s.address ?? '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

function TripHeader({
  truck,
  driver,
  status,
  onChangeStatus,
  canEditStatus,
}: {
  truck: string;
  driver: string;
  status: TripStatus;
  onChangeStatus: (s: TripStatus) => void;
  canEditStatus: boolean;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const navigation = useNavigation();
  return (
    <View
      style={[
        styles.header,
        { backgroundColor: c.card, borderBottomColor: c.border },
      ]}
    >
      <View style={styles.row}>
        <Pressable
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          hitSlop={8}
          style={({ pressed }) => [styles.menuBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="menu" size={24} color={c.foreground} />
        </Pressable>

        <View style={styles.truckBlock}>
          <MaterialCommunityIcons name="truck-outline" size={20} color={c.foreground} />
          <Text style={[styles.truck, { color: c.foreground }]}>{truck}</Text>
        </View>

        {canEditStatus ? (
          <StatusPicker value={status} onChange={onChangeStatus} />
        ) : (
          <View style={{ opacity: 0.5 }}>
            <StatusPicker value={status} onChange={() => {}} />
          </View>
        )}

        <Text style={[styles.driver, { color: c.mutedForeground }]} numberOfLines={1}>
          {driver}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 56,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  menuBtn: { padding: 4 },
  truckBlock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  truck: { fontSize: 16, fontWeight: '700' },
  driver: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '500' },

  body: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  cardHeader: { gap: 4 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  cardSub: { fontSize: 12, fontFamily: 'monospace' },

  stopsBlock: { gap: Spacing.xs },
  stopsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stopsLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stopRow: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 4,
  },
  stopIndex: { fontSize: 13, fontWeight: '600', minWidth: 16 },
  stopAddress: { flex: 1, fontSize: 13 },

  notes: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  notesText: { fontSize: 13, fontStyle: 'italic' },
});
