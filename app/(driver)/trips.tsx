import { Ionicons } from '@expo/vector-icons';
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
import { useMyTrips } from '@/hooks/use-trips';
import { Trip } from '@/lib/types';

export default function TripsScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { data: trips = [], isLoading, refetch } = useMyTrips();
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
          renderItem={({ item }) => <TripRow trip={item} />}
        />
      )}
    </View>
  );
}

function TripRow({ trip }: { trip: Trip }) {
  const c = Colors[useColorScheme() ?? 'light'];
  const date = new Date(trip.createdAt).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: c.card, borderColor: c.border, borderRadius: Radius.md },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.rowTitle, { color: c.foreground }]} numberOfLines={1}>
          {trip.title}
        </Text>
        <Text style={[styles.rowMeta, { color: c.mutedForeground }]} numberOfLines={1}>
          {trip.orderNumber ? `#${trip.orderNumber} · ` : ''}
          {trip.truck?.plate} · {date}
        </Text>
      </View>
      <StatusBadge status={trip.status} />
    </View>
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
});
