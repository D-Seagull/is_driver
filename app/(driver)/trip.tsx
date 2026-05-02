import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { StatusPicker } from '@/components/status-picker';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { TripStatus } from '@/constants/trip-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useActiveTrip, useUpdateMyTripStatus } from '@/hooks/use-trips';
import { useTripChat, ChatMessage } from '@/hooks/use-trip-chat';
import { Trip } from '@/lib/types';
import { useUser } from '@/store/auth';

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TripScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const user = useUser();

  const { data: trip, isLoading, refetch } = useActiveTrip();
  const updateStatus = useUpdateMyTripStatus();

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const handleStatusChange = (next: TripStatus) => {
    if (!trip) return;
    updateStatus.mutate({ id: trip.id, status: next });
  };

  const truckPlate = trip?.truck?.plate ?? user?.currentTruck?.plate ?? '—';
  const driverName = trip?.driver?.name ?? user?.name ?? 'Driver';
  const status: TripStatus = trip?.status ?? 'ASSIGNED';

  return (
    // KAV at root so offset is always 0 (nothing above it).
    // iOS 'padding' — adds paddingBottom = keyboard height, content compresses.
    // Android 'height' — reduces KAV height; needed because edgeToEdgeEnabled
    //   disables the OS-level adjustResize, so we must do it ourselves.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
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
            <RefreshControl refreshing={manualRefreshing} onRefresh={handleManualRefresh} />
          }
        >
          <ScreenPlaceholder
            icon="document-text-outline"
            title="No active trip"
            subtitle="When your dispatcher assigns a trip, it'll show up here. Pull down to refresh."
          />
        </ScrollView>
      ) : (
        <TripWithChat trip={trip} onRefresh={handleManualRefresh} refreshing={manualRefreshing} />
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Trip + Chat combined layout ─────────────────────────────────────────────

function TripWithChat({
  trip,
  onRefresh,
  refreshing,
}: {
  trip: Trip;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const user = useUser();
  const insets = useSafeAreaInsets();
  const { messages, isLoading: chatLoading, connected, sendMessage } = useTripChat(trip.id);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);
  // True while the list is scrolled within ~80px of the bottom. Used to
  // suppress auto-scroll when the user has scrolled up to read history.
  const nearBottomRef = useRef(true);

  // Track keyboard so the input doesn't keep its safe-area paddingBottom
  // while the keyboard is up (KAV already lifts the input above the keyboard;
  // the home-indicator inset is only relevant when the keyboard is closed).
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, () => setKbOpen(true));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Auto-scroll on new messages, but only if the user is already near the
  // bottom — don't yank them away from history they're reading.
  useEffect(() => {
    if (messages.length === 0) return;
    if (!nearBottomRef.current) return;
    const id = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [messages.length]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    sendMessage(trimmed);
    // Sending always pulls the user back down — they clearly want to see it.
    nearBottomRef.current = true;
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Trip info — collapses to make room for chat */}
      <TripInfoCard trip={trip} onRefresh={onRefresh} refreshing={refreshing} />

      {/* Chat area */}
      <View style={[styles.chatWrap, { borderTopColor: c.border }]}>
        {/* Section label */}
        <View style={styles.chatLabel}>
          <Ionicons name="chatbubble-ellipses-outline" size={13} color={c.mutedForeground} />
          <Text style={[styles.chatLabelText, { color: c.mutedForeground }]}>
            Trip chat
          </Text>
          {/* Connection indicator */}
          <View style={[styles.dot, { backgroundColor: connected ? '#10B981' : '#EF4444' }]} />
          <Text style={[styles.chatLabelText, { color: connected ? '#10B981' : '#EF4444' }]}>
            {connected ? 'online' : 'connecting…'}
          </Text>
        </View>

        {/* Messages */}
        {chatLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyChat}>
            <Text style={[styles.emptyChatText, { color: c.mutedForeground }]}>
              No messages yet. Start the conversation.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            style={styles.messageListFlex}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messageList}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              const distanceFromBottom =
                contentSize.height - (contentOffset.y + layoutMeasurement.height);
              nearBottomRef.current = distanceFromBottom < 80;
            }}
            scrollEventThrottle={64}
            // iOS: prevent the list's gesture/inset behavior from swallowing
            // taps to the inputWrap below it. `handled` lets bubble taps still
            // dismiss the keyboard via parent handlers if needed.
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                isMe={item.senderId === user?.id}
              />
            )}
          />
        )}

        {/* Input bar — paddingBottom: safe area when keyboard closed, small when keyboard open */}
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: c.card,
              borderTopColor: c.border,
              paddingBottom: kbOpen ? Spacing.sm : Math.max(insets.bottom, Spacing.sm),
            },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message…"
            placeholderTextColor={c.mutedForeground}
            style={[styles.input, { color: c.foreground, backgroundColor: c.muted }]}
            multiline
            maxLength={1000}
            returnKeyType="default"
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={!text.trim() || !connected}
            style={({ pressed }) => [
              styles.sendBtn,
              {
                backgroundColor: text.trim() && connected ? c.primary : c.muted,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name="send" size={16} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message, isMe }: { message: ChatMessage; isMe: boolean }) {
  const c = Colors[useColorScheme() ?? 'light'];
  const isDispatcher = message.sender.role !== 'DRIVER';
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.bubbleRow, isMe ? styles.bubbleRowMe : styles.bubbleRowOther]}>
      {!isMe && (
        <View style={[styles.avatar, { backgroundColor: isDispatcher ? c.primary : c.muted }]}>
          <Ionicons
            name={isDispatcher ? 'headset-outline' : 'person-outline'}
            size={12}
            color={isDispatcher ? '#fff' : c.mutedForeground}
          />
        </View>
      )}
      <View style={styles.bubbleCol}>
        {!isMe && (
          <Text style={[styles.bubbleSender, { color: c.mutedForeground }]}>
            {message.sender.name ?? (isDispatcher ? 'Dispatcher' : 'Driver')}
          </Text>
        )}
        <View
          style={[
            styles.bubble,
            isMe
              ? { backgroundColor: c.primary, borderBottomRightRadius: 4, borderBottomLeftRadius: Radius.lg }
              : { backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, borderBottomLeftRadius: 4 },
          ]}
        >
          <Text style={[styles.bubbleText, { color: isMe ? '#fff' : c.foreground }]}>
            {message.content}
          </Text>
        </View>
        <Text style={[styles.bubbleTime, { color: c.mutedForeground }]}>{time}</Text>
      </View>
    </View>
  );
}

// ─── Trip info card (collapsible) ────────────────────────────────────────────

function TripInfoCard({
  trip,
  onRefresh,
  refreshing,
}: {
  trip: Trip;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const [collapsed, setCollapsed] = useState(false);
  const loading = trip.stops.filter((s) => s.type === 'LOADING');
  const unloading = trip.stops.filter((s) => s.type === 'UNLOADING');

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderBottomColor: c.border }]}>
      {/* Header row — tap to collapse */}
      <Pressable
        onPress={() => setCollapsed((v) => !v)}
        style={styles.cardHeader}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: c.foreground }]} numberOfLines={collapsed ? 1 : 2}>
            {trip.title}
          </Text>
          {trip.orderNumber ? (
            <Text style={[styles.cardSub, { color: c.mutedForeground }]}>
              #{trip.orderNumber}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={16}
          color={c.mutedForeground}
        />
      </Pressable>

      {!collapsed && (
        <>
          {loading.length > 0 && (
            <StopsBlock label="Loading" color="#10B981" stops={loading} />
          )}
          {unloading.length > 0 && (
            <StopsBlock label="Unloading" color="#EF4444" stops={unloading} />
          )}
          {trip.notes ? (
            <View style={[styles.notes, { borderTopColor: c.border }]}>
              <Text style={[styles.notesText, { color: c.mutedForeground }]}>
                {trip.notes}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

// ─── Stops block ─────────────────────────────────────────────────────────────

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
        <Ionicons name="location-outline" size={13} color={color} />
        <Text style={[styles.stopsLabel, { color }]}>
          {label} ({stops.length})
        </Text>
      </View>
      {stops.map((s, i) => (
        <View key={s.id} style={styles.stopRow}>
          <Text style={[styles.stopIndex, { color: c.mutedForeground }]}>{i + 1}.</Text>
          <Text style={[styles.stopAddress, { color: c.foreground }]} numberOfLines={2}>
            {s.address ?? '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

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
  const { top } = useSafeAreaInsets();
  return (
    <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border, paddingTop: top + Spacing.sm }]}>
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  menuBtn: { padding: 4 },
  truckBlock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  truck: { fontSize: 16, fontWeight: '700' },
  driver: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '500' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Trip info card
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardSub: { fontSize: 12, fontFamily: 'monospace', marginTop: 2 },

  stopsBlock: { gap: 4 },
  stopsHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stopsLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  stopRow: { flexDirection: 'row', gap: 6, paddingLeft: 2 },
  stopIndex: { fontSize: 12, fontWeight: '600', minWidth: 14 },
  stopAddress: { flex: 1, fontSize: 12 },

  notes: { paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  notesText: { fontSize: 12, fontStyle: 'italic' },

  // Chat
  chatWrap: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chatLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  chatLabelText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginLeft: 4,
  },
  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emptyChatText: { fontSize: 13, textAlign: 'center' },
  // flex:1 constrains FlatList within chatWrap — without it, FlatList expands
  // to full content height, overflows the parent, and its scroll area swallows
  // all taps to the inputWrap below it (iOS) or pushes input off screen (Android)
  messageListFlex: { flex: 1 },
  messageList: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.lg },

  // Bubbles
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginBottom: 6,
  },
  bubbleRowMe: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubbleCol: { maxWidth: '75%', gap: 2 },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  bubbleSender: { fontSize: 10, fontWeight: '600', paddingLeft: 4 },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.lg,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTime: { fontSize: 10, paddingLeft: 4 },

  // Input bar
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
