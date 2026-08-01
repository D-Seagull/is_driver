import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useActiveTrip, useMyTrips } from '@/hooks/use-trips';
import { formatDate } from '@/lib/format-date';
import { Trip } from '@/lib/types';

type TripVariant = 'active' | 'next' | 'done';
type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'trip'; trip: Trip; variant: TripVariant };

export default function TripsScreen() {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const { data: trips = [], isLoading, refetch } = useMyTrips();
  const { data: activeTrip } = useActiveTrip();
  const activeId = activeTrip?.id ?? null;
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
    return trips.filter((trip) => {
      if (trip.title.toLowerCase().includes(q)) return true;
      if ((trip.orderNumber ?? '').toLowerCase().includes(q)) return true;
      if ((trip.truck?.plate ?? '').toLowerCase().includes(q)) return true;
      if (trip.stops.some((s) => (s.address ?? '').toLowerCase().includes(q))) return true;
      return false;
    });
  }, [trips, query]);

  // Group the (filtered) trips into Active · Upcoming · Completed so a
  // pre-assigned next trip can't be mistaken for the one in progress.
  const rows = useMemo<Row[]>(() => {
    const active: Trip[] = [];
    const next: Trip[] = [];
    const done: Trip[] = [];
    for (const trip of filtered) {
      if (trip.id === activeId) active.push(trip);
      else if (trip.status === 'DELIVERED') done.push(trip);
      else next.push(trip);
    }
    const out: Row[] = [];
    const section = (key: string, label: string, list: Trip[], variant: TripVariant) => {
      if (list.length === 0) return;
      out.push({ kind: 'header', key, label });
      list.forEach((trip) => out.push({ kind: 'trip', trip, variant }));
    };
    section('active', t('trips.active'), active, 'active');
    section('next', t('trips.next'), next, 'next');
    section('done', t('trips.done'), done, 'done');
    return out;
  }, [filtered, activeId, t]);

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
          placeholder={t('trips.searchPlaceholder')}
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
            title={t('trips.empty.title')}
            subtitle={t('trips.empty.subtitle')}
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
            title={t('trips.noMatches.title')}
            subtitle={t('trips.noMatches.subtitle')}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => (row.kind === 'header' ? `h:${row.key}` : row.trip.id)}
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
          refreshControl={
            <RefreshControl refreshing={manualRefreshing} onRefresh={handleManualRefresh} />
          }
          renderItem={({ item }) =>
            item.kind === 'header' ? (
              <Text style={[styles.sectionHeader, { color: c.mutedForeground }]}>
                {item.label}
              </Text>
            ) : (
              <TripRow
                trip={item.trip}
                variant={item.variant}
                unreadCount={tripUnread[item.trip.id] ?? 0}
              />
            )
          }
        />
      )}
    </View>
  );
}

const GREEN = '#10B981';

function TripRow({
  trip,
  variant,
  unreadCount,
}: {
  trip: Trip;
  variant: TripVariant;
  unreadCount: number;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const hasUnread = unreadCount > 0;
  const isActive = variant === 'active';
  const isDone = variant === 'done';
  const date = formatDate(trip.createdAt, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const unreadBg = scheme === 'dark' ? 'rgba(59,130,246,0.12)' : '#eff6ff';
  const unreadBorder = scheme === 'dark' ? 'rgba(59,130,246,0.35)' : '#93c5fd';
  const activeBg = scheme === 'dark' ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.10)';

  const bg = isActive ? activeBg : hasUnread ? unreadBg : c.card;
  const border = isActive ? 'rgba(16,185,129,0.45)' : hasUnread ? unreadBorder : c.border;
  const icon = isActive ? 'navigate' : isDone ? 'checkmark-done' : 'time-outline';

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/(driver)/trip', params: { tripId: trip.id } })}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: bg,
          borderColor: border,
          borderRadius: Radius.md,
          opacity: pressed ? 0.7 : isDone ? 0.6 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.lead,
          { backgroundColor: isActive ? GREEN : c.muted },
        ]}
      >
        <Ionicons name={icon} size={17} color={isActive ? '#fff' : c.mutedForeground} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {hasUnread && <View style={styles.dot} />}
          <Text
            style={[
              styles.rowTitle,
              {
                color: c.foreground,
                fontWeight: isActive || hasUnread ? '700' : '600',
                flexShrink: 1,
              },
            ]}
            numberOfLines={1}
          >
            {trip.title}
          </Text>
          {isActive && (
            <View style={[styles.pill, { backgroundColor: GREEN }]}>
              <Text style={styles.pillText}>{t('trips.active')}</Text>
            </View>
          )}
          {variant === 'next' && (
            <View style={[styles.tag, { backgroundColor: c.muted }]}>
              <Text style={[styles.tagText, { color: c.mutedForeground }]}>
                {t('trips.nextTag')}
              </Text>
            </View>
          )}
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
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.xs,
    marginBottom: -2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  lead: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    flexShrink: 0,
  },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    flexShrink: 0,
  },
  tagText: { fontSize: 10, fontWeight: '600' },
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
