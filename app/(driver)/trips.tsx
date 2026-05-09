import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { StatusBadge } from '@/components/status-picker';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDriverUnread } from '@/hooks/use-driver-unread';
import { useMyTrips } from '@/hooks/use-trips';
import { Trip } from '@/lib/types';

export default function TripsScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { data: trips = [], isLoading, refetch } = useMyTrips();
  const { data: unreadData } = useDriverUnread();
  const tripUnread = unreadData?.tripUnread ?? {};
  const [query, setQuery] = useState('');
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return trips;
    return trips.filter((t) => {
      if (t.title.toLowerCase().includes(q)) return true;
      if ((t.orderNumber ?? '').toLowerCase().includes(q)) return true;
      if ((t.truck?.plate ?? '').toLowerCase().includes(q)) return true;
      if (t.stops.some((s) => (s.address ?? '').toLowerCase().includes(q))) return true;
      return false;
    });
  }, [trips, query]);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={[
          styles.searchWrap,
          { backgroundColor: c.card, borderColor: c.border, borderRadius: Radius.md },
        ]}
      >
        <Ionicons name="search" size={16} color={c.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by route, order #, address…"
          placeholderTextColor={c.mutedForeground}
          style={[styles.searchInput, { color: c.foreground }]}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={c.mutedForeground} />
          </Pressable>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : trips.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={manualRefreshing} onRefresh={handleManualRefresh} />
          }
        >
          <ScreenPlaceholder
            icon="list-outline"
            title="No trips yet"
            subtitle="Trips assigned to you will appear here."
          />
        </ScrollView>
      ) : filtered.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={manualRefreshing} onRefresh={handleManualRefresh} />
          }
        >
          <ScreenPlaceholder
            icon="search-outline"
            title="No matches"
            subtitle="Try a different search."
          />
        </ScrollView>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
          refreshControl={
            <RefreshControl refreshing={manualRefreshing} onRefresh={handleManualRefresh} />
          }
          renderItem={({ item }) => <TripRow trip={item} unreadCount={tripUnread[item.id] ?? 0} />}
        />
      )}
    </View>
  );
}

function TripRow({ trip, unreadCount }: { trip: Trip; unreadCount: number }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const hasUnread = unreadCount > 0;
  const date = new Date(trip.createdAt).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const unreadBg   = scheme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff';
  const unreadBorder = scheme === 'dark' ? 'rgba(59,130,246,0.35)' : '#93c5fd';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/(driver)/trip', params: { tripId: trip.id } })}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: hasUnread ? unreadBg : c.card,
          borderColor: hasUnread ? unreadBorder : c.border,
          borderRadius: Radius.md,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {hasUnread && <View style={styles.dot} />}
          <Text
            style={[styles.rowTitle, { color: c.foreground, fontWeight: hasUnread ? '700' : '600' }]}
            numberOfLines={1}
          >
            {trip.title}
          </Text>
        </View>
        <Text style={[styles.rowMeta, { color: c.mutedForeground }]} numberOfLines={1}>
          {trip.orderNumber ? `#${trip.orderNumber} · ` : ''}
          {trip.truck?.plate} · {date}
        </Text>
      </View>
      {hasUnread && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount}</Text>
        </View>
      )}
      <StatusBadge status={trip.status} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    margin: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#60a5fa', flexShrink: 0,
  },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: '#f87171',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
