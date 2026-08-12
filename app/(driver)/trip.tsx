import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { fullName } from "@/lib/format";
import {
  DrawerActions,
  useIsFocused,
  useNavigation,
} from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { router, Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// Stable KeyboardAvoidingView for the new architecture + edge-to-edge, where
// RN's built-in one (behavior="height") lets the input jump. Requires the
// <KeyboardProvider> mounted in app/_layout.tsx.
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import EmojiPicker from "rn-emoji-keyboard";

import { MessageReactionsCluster } from "@/components/message-reactions";
import { MessageActionsSheet, type MessageActions } from "@/components/message-actions-sheet";
import { MessageQuote } from "@/components/message-quote";
import { ScreenPlaceholder } from "@/components/screen-placeholder";
import { StatusPicker } from "@/components/status-picker";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { TripStatus } from "@/constants/trip-status";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTripDocuments, useUploadDocuments } from "@/hooks/use-documents";
import { NotificationBell } from "@/components/notification-bell";
import { ChatMessage, useTripChat } from "@/hooks/use-trip-chat";
import {
  useActiveTrip,
  useMyTrips,
  useTrip,
  useUpdateMyTripStatus,
} from "@/hooks/use-trips";
import { DriverDocument, UploadFileLocal } from "@/lib/documents-api";
import { formatDate, formatTime } from "@/lib/format-date";
import { systemMessageText } from "@/lib/system-message";
import { Trip } from "@/lib/types";
import { useUser } from "@/store/auth";

// Reply target for the composer banner — a message or a document quote.
type TripReplyTarget = {
  id: string;
  targetType: "msg" | "doc";
  senderName: string | null;
  content: string;
  isDeleted: boolean;
};

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TripScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const user = useUser();

  // When opened from My Trips list a tripId param is passed → load that
  // specific trip. Otherwise default to the driver's currently active trip.
  const params = useLocalSearchParams<{ tripId?: string }>();
  const explicitTripId =
    typeof params.tripId === "string" ? params.tripId : undefined;

  const activeQuery = useActiveTrip();
  const specificQuery = useTrip(explicitTripId);
  const trip = explicitTripId ? specificQuery.data : activeQuery.data;
  const isLoading = explicitTripId
    ? specificQuery.isLoading
    : activeQuery.isLoading;
  const refetch = explicitTripId ? specificQuery.refetch : activeQuery.refetch;
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

  // Plate falls back to whichever truck is currently linked to the driver.
  // If there's no truck at all — leave it null and the header hides the block
  // entirely (no lone dash next to a phantom truck icon).
  const truckPlate = trip?.truck?.plate ?? user?.currentTruck?.plate ?? null;
  const driverName = fullName(trip?.driver) || fullName(user) || t("nav.driverFallback");
  const status: TripStatus = trip?.status ?? "ASSIGNED";

  return (
    // keyboard-controller's KeyboardAvoidingView (behavior="padding") lifts the
    // input above the keyboard reliably on both platforms — including Android
    // under edge-to-edge / new architecture, where RN's built-in "height"
    // behavior squeezes the layout and makes the input jump.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <TripHeader
        truck={truckPlate ?? ""}
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
            <RefreshControl
              refreshing={manualRefreshing}
              onRefresh={handleManualRefresh}
            />
          }
        >
          <ScreenPlaceholder
            icon="document-text-outline"
            title={t("trip.noActiveTrip.title")}
            subtitle={t("trip.noActiveTrip.subtitle")}
          />
        </ScrollView>
      ) : (
        <TripWithChat
          trip={trip}
          onRefresh={handleManualRefresh}
          refreshing={manualRefreshing}
          isActiveView={!explicitTripId}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Trip + Chat combined layout ─────────────────────────────────────────────

function TripWithChat({
  trip,
  onRefresh,
  refreshing,
  isActiveView,
}: {
  trip: Trip;
  onRefresh: () => void;
  refreshing: boolean;
  isActiveView: boolean;
}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? "light"];
  const user = useUser();
  // On the active-trip view, surface any pre-assigned upcoming trip as a
  // clearly-separate strip so the driver doesn't confuse it with this one.
  const { data: myTrips = [] } = useMyTrips();
  const nextTrip = isActiveView
    ? myTrips.find((tp) => tp.id !== trip.id && tp.status !== "DELIVERED")
    : undefined;
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  // The "next trip" strip is a transient heads-up, not a permanent fixture:
  // it fades in when a newly-assigned upcoming order first appears (or when
  // the driver opens the active trip with one already queued) and fades out
  // after a few seconds. The order stays reachable from the Trips list.
  const [showNextStrip, setShowNextStrip] = useState(false);
  const nextStripOpacity = useRef(new Animated.Value(0)).current;
  const shownNextIdRef = useRef<string | null>(null);
  const nextTripId = nextTrip?.id ?? null;
  useEffect(() => {
    if (!nextTripId || !isFocused) return;
    if (shownNextIdRef.current === nextTripId) return; // already flashed this one
    shownNextIdRef.current = nextTripId;
    setShowNextStrip(true);
    nextStripOpacity.setValue(0);
    Animated.timing(nextStripOpacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
    const hide = setTimeout(() => {
      Animated.timing(nextStripOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => finished && setShowNextStrip(false));
    }, 4000);
    return () => clearTimeout(hide);
  }, [nextTripId, isFocused, nextStripOpacity]);

  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<TripReplyTarget | null>(null);
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(null);
  const [msgSheetFor, setMsgSheetFor] = useState<ChatMessage | null>(null);
  const [docSheetFor, setDocSheetFor] = useState<DriverDocument | null>(null);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const listRef = useRef<FlatList>(null);
  // True while the list is scrolled within ~80px of the bottom. Used to
  // suppress auto-scroll when the user has scrolled up to read history.
  const nearBottomRef = useRef(true);
  // False until the first scroll-to-bottom completes — so the initial jump
  // is instant (no visible scroll-from-top animation).
  const initialScrollDone = useRef(false);
  // True once the FlatList has fired its first onLayout — i.e. it has been
  // measured and is ready to accept scrollToEnd commands.  On Android the
  // layout pass often completes AFTER the data useEffect fires, so we gate
  // the effect on this flag and let onLayout drive the initial scroll instead.
  const listLaidOut = useRef(false);

  // nearBottomRef must be declared BEFORE useTripChat so the hook receives
  // the real ref object (not undefined due to Babel var-hoisting).
  const {
    messages,
    isLoading: chatLoading,
    connected,
    loadOlder,
    loadingOlder,
    hasMore,
    sendMessage,
    editMessage,
    deleteMessage,
    removeDocument,
    markReadNow,
    typers,
    notifyTyping,
    notifyStopTyping,
  } = useTripChat(trip.id, { isFocused, nearBottomRef });
  // `useTripChat` itself owns the `reaction_changed` listener since trip
  // messages live in its local state (not React Query). No extra hook needed.
  const { data: tripDocs = [] } = useTripDocuments(trip.id);
  const upload = useUploadDocuments();

  // Privacy: only the trip's current driver can write messages. Old drivers
  // get read-only access to their own historical chat.
  // While auth is still hydrating user can be null — keep the input visible
  // (server-side guard rejects the send anyway). Only hide once we *know*
  // the user is not the current driver.
  const isActiveDriver = !user || trip.driver?.id === user.id;

  // Unified timeline: messages + documents sorted by createdAt.
  type TimelineItem =
    | { kind: "msg"; data: ChatMessage }
    | { kind: "doc"; data: DriverDocument };

  const timeline: TimelineItem[] = useMemo(() => {
    const items: TimelineItem[] = [
      ...messages.map((m) => ({ kind: "msg" as const, data: m })),
      ...tripDocs.map((d) => ({ kind: "doc" as const, data: d })),
    ];
    items.sort(
      (a, b) =>
        new Date(a.data.createdAt).getTime() -
        new Date(b.data.createdAt).getTime(),
    );
    return items;
  }, [messages, tripDocs]);

  // Keep the latest timeline in a ref so scrollToMessage can stay referentially
  // stable (empty deps) — otherwise it changes every render and busts memo on
  // every MessageBubble that receives it as onReplyJump.
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;

  // Jump to a replied-to message/document + briefly highlight it.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollToMessage = useCallback((targetId?: string | null) => {
    if (!targetId) return;
    const index = timelineRef.current.findIndex((it) => it.data.id === targetId);
    if (index < 0) return; // original is older than the loaded page
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setHighlightId(targetId);
    setTimeout(() => setHighlightId((h) => (h === targetId ? null : h)), 1500);
  }, []);

  // When the keyboard opens, snap the message list to the bottom so the last
  // message stays visible above the input instead of getting hidden behind it.
  useEffect(() => {
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const showSub = Keyboard.addListener(showEvt, () => {
      if (nearBottomRef.current) {
        // Two passes — iOS lays out KAV padding asynchronously; without the
        // second tick the scroll lands above the new bottom.
        requestAnimationFrame(() =>
          listRef.current?.scrollToEnd({ animated: true }),
        );
        setTimeout(
          () => listRef.current?.scrollToEnd({ animated: false }),
          250,
        );
      }
    });
    return () => {
      showSub.remove();
    };
  }, []);

  // Auto-scroll when new timeline items arrive (messages OR docs), but only
  // if the user is already near the bottom.
  // • First scroll: instant (no visible scroll-from-top animation).
  // • Subsequent scrolls (new messages): animated glide.
  // • Android: the FlatList layout pass often completes AFTER this effect fires
  //   on initial load, so we skip if not yet laid out — onLayout will call
  //   the initial scroll instead once the list is ready.
  // Tracks the newest timeline item so a length change from *prepended* older
  // history (loadOlder) isn't mistaken for a freshly-arrived message.
  const lastNewestIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (timeline.length === 0) return;
    if (!listLaidOut.current) return; // onLayout will handle the first scroll
    const newestId = timeline[timeline.length - 1]?.data.id ?? null;
    const isAppend = newestId !== lastNewestIdRef.current;
    lastNewestIdRef.current = newestId;
    if (nearBottomRef.current) {
      // User is at/near the bottom — auto-scroll to new content.
      const animated = initialScrollDone.current; // false → instant on first load
      initialScrollDone.current = true;
      const delay = Platform.OS === "android" ? 150 : 50;
      const id = setTimeout(
        () => listRef.current?.scrollToEnd({ animated }),
        delay,
      );
      return () => clearTimeout(id);
    } else if (initialScrollDone.current && isAppend) {
      // User has scrolled up to read history — show "↓ N new" pill instead
      // of yanking them back down (Viber/Telegram pattern). Only for genuinely
      // new (appended) messages — prepended history must not bump the count.
      setNewMsgCount((n) => n + 1);
    }
  }, [timeline.length]);

  // Re-scroll to bottom when the screen regains focus (e.g. user navigated
  // away to Trips and came back).  Only if already near the bottom so we
  // don't interrupt manual scroll-up history reading.
  useEffect(() => {
    if (!isFocused) return;
    const id = setTimeout(() => {
      if (nearBottomRef.current) {
        listRef.current?.scrollToEnd({ animated: false });
      }
    }, 100);
    return () => clearTimeout(id);
  }, [isFocused]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (editing) {
      if (trimmed !== editing.original.trim()) editMessage(editing.id, trimmed);
      setEditing(null);
      setText("");
      return;
    }

    const replyMsgId = replyingTo?.targetType === "msg" ? replyingTo.id : null;
    const replyDocId = replyingTo?.targetType === "doc" ? replyingTo.id : null;
    setText("");
    setReplyingTo(null);
    sendMessage(trimmed, {
      replyToId: replyMsgId,
      replyToDocumentId: replyDocId,
    });
    // Sending always pulls the user back down — they clearly want to see it.
    nearBottomRef.current = true;
  };

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

  // ── Upload flow ─────────────────────────────────────────────────────────
  const pickAndUpload = async (source: "camera" | "gallery" | "document") => {
    let files: UploadFileLocal[] = [];
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const r = await ImagePicker.launchCameraAsync({ quality: 0.8 });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? `photo-${Date.now()}.jpg`,
          mimeType: a.mimeType ?? "image/jpeg",
        }));
      } else if (source === "gallery") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          quality: 0.8,
        });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? `photo-${Date.now()}.jpg`,
          mimeType: a.mimeType ?? "image/jpeg",
        }));
      } else {
        const r = await DocumentPicker.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
          type: "*/*",
        });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.name,
          mimeType: a.mimeType ?? "application/octet-stream",
        }));
      }
      if (files.length === 0) return;
      await upload.mutateAsync({ tripId: trip.id, files });
      nearBottomRef.current = true;
    } catch (e) {
      Alert.alert(t("documents.uploadFailed"), (e as Error).message);
    }
  };

  const showUploadSheet = () => {
    Alert.alert(t("trip.attachSheet.title"), t("documents.uploadSheet.subtitle"), [
      { text: t("documents.uploadSheet.camera"), onPress: () => pickAndUpload("camera") },
      { text: t("documents.uploadSheet.gallery"), onPress: () => pickAndUpload("gallery") },
      { text: t("documents.uploadSheet.file"), onPress: () => pickAndUpload("document") },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const handleOpenDoc = useCallback(
    async (doc: DriverDocument) => {
      try {
        await WebBrowser.openBrowserAsync(doc.signedUrl);
      } catch (e) {
        Alert.alert(t("documents.cannotOpen"), (e as Error).message);
      }
    },
    [t],
  );

  // Stable long-press handlers so memoized bubbles don't re-render every time
  // the parent re-renders (typing indicator, keyboard, new message, …).
  const handleMsgLongPress = useCallback(
    (m: ChatMessage) => setMsgSheetFor(m),
    [],
  );
  const handleDocLongPress = useCallback(
    (d: DriverDocument) => setDocSheetFor(d),
    [],
  );

  // Row renderer — memoized so FlatList only re-runs it when one of these
  // deps actually changes. Combined with memo() on the bubbles below, an
  // unrelated parent re-render no longer touches any row.
  const renderTimelineItem = useCallback(
    ({ item }: { item: TimelineItem }) => {
      if (item.kind === "msg") {
        // System events (driver/manager changed) — Telegram-style centered
        // grey label, no avatar/bubble.
        if (item.data.isSystem) {
          return <SystemNotice text={item.data.content} />;
        }
        const isMe = item.data.senderId === user?.id;
        return (
          <MessageBubble
            message={item.data}
            isMe={isMe}
            currentUserId={user?.id}
            highlighted={item.data.id === highlightId}
            onLongPress={handleMsgLongPress}
            onReplyJump={scrollToMessage}
          />
        );
      }
      const isMe = item.data.uploadedBy === user?.id;
      return (
        <DocBubble
          doc={item.data}
          isMe={isMe}
          highlighted={item.data.id === highlightId}
          onOpen={handleOpenDoc}
          onLongPress={handleDocLongPress}
        />
      );
    },
    [
      user?.id,
      highlightId,
      handleMsgLongPress,
      handleDocLongPress,
      handleOpenDoc,
      scrollToMessage,
    ],
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Trip info — collapses to make room for chat */}
      <TripInfoCard trip={trip} onRefresh={onRefresh} refreshing={refreshing} />

      {/* Pre-assigned upcoming trip — transient heads-up that auto-fades a
          few seconds after it appears (order stays in the Trips list). */}
      {showNextStrip && nextTrip && (
        <Animated.View style={{ opacity: nextStripOpacity }}>
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(driver)/trip",
                params: { tripId: nextTrip.id },
              })
            }
            style={({ pressed }) => [
              styles.nextStrip,
              { backgroundColor: c.card, borderLeftColor: c.mutedForeground, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name="arrow-forward" size={16} color={c.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.nextStripTitle, { color: c.foreground }]} numberOfLines={1}>
                {t("trip.nextTripLabel", { title: nextTrip.title })}
              </Text>
              <Text style={[styles.nextStripHint, { color: c.mutedForeground }]} numberOfLines={1}>
                {t("trip.nextTripHint")}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.mutedForeground} />
          </Pressable>
        </Animated.View>
      )}

      {/* Chat area */}
      <View style={[styles.chatWrap, { borderTopColor: c.border }]}>
        {/* Section label */}
        <View style={styles.chatLabel}>
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={13}
            color={c.mutedForeground}
          />
          <Text style={[styles.chatLabelText, { color: c.mutedForeground }]}>
            {t("trip.chatLabel")}
          </Text>
          {/* Connection indicator */}
          <View
            style={[
              styles.dot,
              { backgroundColor: connected ? "#10B981" : "#f87171" },
            ]}
          />
          <Text
            style={[
              styles.chatLabelText,
              { color: connected ? "#10B981" : "#f87171" },
            ]}
          >
            {connected ? t("trip.online") : t("trip.connecting")}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => setDocsOpen(true)}
            hitSlop={6}
            style={({ pressed }) => [
              styles.folderBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons
              name="folder-outline"
              size={16}
              color={c.mutedForeground}
            />
            <Text style={[styles.chatLabelText, { color: c.mutedForeground }]}>
              {tripDocs.length}
            </Text>
          </Pressable>
        </View>

        {/* Timeline (messages + docs) */}
        {chatLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={c.primary} />
          </View>
        ) : timeline.length === 0 ? (
          <View style={styles.emptyChat}>
            <Text style={[styles.emptyChatText, { color: c.mutedForeground }]}>
              {t("chat.emptyChat")}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={timeline}
            style={styles.messageListFlex}
            keyExtractor={(item) =>
              item.kind === "msg" ? `m-${item.data.id}` : `d-${item.data.id}`
            }
            contentContainerStyle={styles.messageList}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } =
                e.nativeEvent;
              const distanceFromBottom =
                contentSize.height -
                (contentOffset.y + layoutMeasurement.height);
              const wasNearBottom = nearBottomRef.current;
              nearBottomRef.current = distanceFromBottom < 80;
              if (!wasNearBottom && nearBottomRef.current) {
                // User scrolled back to bottom — dismiss pill and ack messages
                setNewMsgCount(0);
                markReadNow();
              }
              // Scrolled near the top — pull the previous page of history.
              // maintainVisibleContentPosition below keeps the viewport anchored
              // so the prepended messages don't yank the list.
              if (contentOffset.y < 60 && hasMore && !loadingOlder) {
                loadOlder();
              }
            }}
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
            ListHeaderComponent={
              loadingOlder ? (
                <View style={{ paddingVertical: Spacing.md }}>
                  <ActivityIndicator size="small" color={c.mutedForeground} />
                </View>
              ) : null
            }
            // Called once the FlatList has been measured and is ready to
            // scroll.  On Android this fires AFTER the data useEffect, so
            // we do the initial scroll here if it hasn't happened yet.
            onLayout={() => {
              if (listLaidOut.current) return;
              listLaidOut.current = true;
              if (
                timeline.length > 0 &&
                nearBottomRef.current &&
                !initialScrollDone.current
              ) {
                // Extra tick for Android to commit the full render tree
                setTimeout(
                  () => {
                    listRef.current?.scrollToEnd({ animated: false });
                    initialScrollDone.current = true;
                  },
                  Platform.OS === "android" ? 120 : 0,
                );
              }
            }}
            // Photos in doc bubbles load asynchronously — when the image
            // loads, contentSize grows AFTER our scrollToEnd already ran,
            // leaving the doc tucked under the input. Re-scroll whenever
            // content grows while we're near the bottom.
            // On Android: wrap in setTimeout to avoid calling during an
            // active layout pass (causes silent scroll failures).
            onContentSizeChange={() => {
              if (!nearBottomRef.current) return;
              const scroll = () =>
                listRef.current?.scrollToEnd({ animated: false });
              Platform.OS === "android" ? setTimeout(scroll, 50) : scroll();
            }}
            scrollEventThrottle={64}
            // iOS: prevent the list's gesture/inset behavior from swallowing
            // taps to the inputWrap below it. `handled` lets bubble taps still
            // dismiss the keyboard via parent handlers if needed.
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            onScrollToIndexFailed={() => {}}
            extraData={highlightId}
            renderItem={renderTimelineItem}
          />
        )}
        {/* "↓ N new" pill — absolute overlay at the bottom of chatWrap (just
            above where inputWrap begins as a sibling).  Constrained width so
            its absolute frame can't stretch the full parent and intercept
            taps meant for the input. */}
        {newMsgCount > 0 && (
          <Pressable
            style={[styles.scrollDownBtn, { backgroundColor: c.primary }]}
            onPress={() => {
              nearBottomRef.current = true;
              setNewMsgCount(0);
              markReadNow();
              listRef.current?.scrollToEnd({ animated: true });
            }}
          >
            <Ionicons name="chevron-down" size={16} color="#fff" />
            <Text style={styles.scrollDownText}>{t("trip.newCount", { count: newMsgCount })}</Text>
          </Pressable>
        )}
      </View>

      {/* Typing indicator — animated dots, matches direct-chat style on web.
          Only renders when the counterparty is actively typing; auto-clears
          after 4s if the stopTyping signal is lost. */}
      {typers.size > 0 && (
        <View style={[styles.typingRow, { backgroundColor: c.background }]}>
          <Text
            style={[styles.typingText, { color: c.mutedForeground }]}
            numberOfLines={1}
          >
            {Array.from(typers.values()).join(", ")}{" "}
            {typers.size === 1 ? t("chat.typingOne") : t("chat.typingMany")}
          </Text>
          <TypingDots color={c.mutedForeground} />
        </View>
      )}

      {/* Input bar — moved OUT of chatWrap so the FlatList's iOS scroll-content
          rect can never extend over the TextInput's hit area. paddingBottom
          always clears the safe area / Android nav bar so the input stays
          pinned to the very bottom on every device (the KAV lifts it above
          the keyboard when open). */}
      {!isActiveDriver ? (
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: c.card,
              borderTopColor: c.border,
              paddingBottom: Math.max(insets.bottom, Spacing.sm),
              justifyContent: "center",
            },
          ]}
        >
          <Text style={[styles.inactiveNotice, { color: c.mutedForeground }]}>
            {t("trip.readOnlyNotice")}
          </Text>
        </View>
      ) : (
        <>
          {(replyingTo || editing) && (
            <View
              style={[
                styles.replyBanner,
                { backgroundColor: c.card, borderTopColor: c.border },
              ]}
            >
              <View style={[styles.replyBannerBar, { backgroundColor: c.primary }]} />
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.replyBannerTitle, { color: c.primary }]}
                  numberOfLines={1}
                >
                  {editing
                    ? t("chat.editingMessage")
                    : t("chat.replyTo", {
                        name: replyingTo?.senderName ?? t("chat.unknownSender"),
                      })}
                </Text>
                <Text
                  style={[styles.replyBannerText, { color: c.mutedForeground }]}
                  numberOfLines={1}
                >
                  {editing
                    ? editing.original
                    : replyingTo?.isDeleted
                    ? t("chat.deleted")
                    : replyingTo?.content}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setReplyingTo(null);
                  if (editing) setText("");
                  setEditing(null);
                }}
                hitSlop={8}
                style={{ padding: 4 }}
              >
                <Ionicons name="close" size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
          )}
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: c.card,
                borderTopColor: c.border,
                paddingBottom: Math.max(insets.bottom, Spacing.sm),
              },
            ]}
          >
          <Pressable
            onPress={showUploadSheet}
            disabled={upload.isPending}
            hitSlop={6}
            style={({ pressed }) => [
              styles.iconBtn,
              { opacity: pressed || upload.isPending ? 0.5 : 1 },
            ]}
          >
            {upload.isPending ? (
              <ActivityIndicator size="small" color={c.mutedForeground} />
            ) : (
              <Ionicons name="attach" size={22} color={c.mutedForeground} />
            )}
          </Pressable>
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setEmojiOpen(true);
            }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.iconBtn,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons
              name="happy-outline"
              size={22}
              color={c.mutedForeground}
            />
          </Pressable>
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (v.length > 0) notifyTyping();
              else notifyStopTyping();
            }}
            onBlur={notifyStopTyping}
            placeholder={t("chat.messagePlaceholder")}
            placeholderTextColor={c.mutedForeground}
            style={[
              styles.input,
              { color: c.foreground, backgroundColor: c.muted },
            ]}
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
        </>
      )}

      <EmojiPicker
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onEmojiSelected={(e) => setText((prev) => prev + e.emoji)}
      />

      {/* Long-press menu for a message — reply / copy / edit / delete */}
      <MessageActionsSheet
        visible={!!msgSheetFor}
        onClose={() => setMsgSheetFor(null)}
        actions={
          !msgSheetFor
            ? {}
            : {
                onReply: msgSheetFor.deletedAt
                  ? undefined
                  : () => {
                      const m = msgSheetFor;
                      setReplyingTo({
                        id: m.id,
                        targetType: "msg",
                        senderName: fullName(m.sender) || null,
                        content: m.content,
                        isDeleted: !!m.deletedAt,
                      });
                      setEditing(null);
                    },
                onCopy: () => Clipboard.setStringAsync(msgSheetFor.content),
                onEdit:
                  msgSheetFor.senderId === user?.id &&
                  !msgSheetFor.deletedAt &&
                  Date.now() - new Date(msgSheetFor.createdAt).getTime() <
                    15 * 60 * 1000
                    ? () => {
                        const m = msgSheetFor;
                        setEditing({ id: m.id, original: m.content });
                        setText(m.content);
                        setReplyingTo(null);
                      }
                    : undefined,
                onDelete:
                  msgSheetFor.senderId === user?.id && !msgSheetFor.deletedAt
                    ? () => deleteMessage(msgSheetFor.id)
                    : undefined,
              }
        }
      />

      {/* Long-press menu for a document — reply + delete only */}
      <MessageActionsSheet
        visible={!!docSheetFor}
        onClose={() => setDocSheetFor(null)}
        actions={
          !docSheetFor
            ? {}
            : {
                onReply: () => {
                  const d = docSheetFor;
                  setReplyingTo({
                    id: d.id,
                    targetType: "doc",
                    senderName: d.uploader ? fullName(d.uploader) : null,
                    content: d.fileName,
                    isDeleted: false,
                  });
                  setEditing(null);
                },
                onDelete:
                  docSheetFor.uploadedBy === user?.id
                    ? () => removeDocument(docSheetFor.id)
                    : undefined,
              }
        }
      />

      <TripDocsModal
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        docs={tripDocs}
        onUpload={showUploadSheet}
        uploading={upload.isPending}
        onOpenDoc={handleOpenDoc}
      />
    </View>
  );
}

// ─── Typing dots (animated) ──────────────────────────────────────────────────

function TypingDots({ color }: { color: string }) {
  // Three Animated values, started with staggered delays so the dots bounce
  // in a "wave". Same visual rhythm as the web `animate-bounce delay-0/100/200`.
  const dots = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {dots.map((dot, i) => (
        <Animated.Text
          key={i}
          style={[
            { color, fontSize: 14, lineHeight: 14 },
            {
              transform: [
                {
                  translateY: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -3],
                  }),
                },
              ],
            },
          ]}
        >
          .
        </Animated.Text>
      ))}
    </View>
  );
}

// ─── System notice (driver/manager changed) ───────────────────────────────

const SystemNotice = memo(function SystemNotice({ text }: { text: string }) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? "light"];
  return (
    <View style={styles.systemRow}>
      <Text
        style={[
          styles.systemText,
          { color: c.mutedForeground, backgroundColor: c.muted },
        ]}
      >
        {systemMessageText(text, t)}
      </Text>
    </View>
  );
});

// ─── Message bubble ───────────────────────────────────────────────────────────

// Broadcasts are sent as "subject\n\nbody" (manager's "Розсилка" dialog). Show
// the subject line in bold so it reads as a heading in the driver's chat.
function splitBroadcastSubject(content: string): {
  subject: string | null;
  body: string;
} {
  const sep = content.indexOf("\n\n");
  if (sep <= 0) return { subject: null, body: content };
  return { subject: content.slice(0, sep), body: content.slice(sep + 2) };
}

const MessageBubble = memo(function MessageBubble({
  message,
  isMe,
  currentUserId,
  highlighted,
  onLongPress,
  onReplyJump,
}: {
  message: ChatMessage;
  isMe: boolean;
  currentUserId?: string;
  highlighted?: boolean;
  onLongPress?: (m: ChatMessage) => void;
  onReplyJump: (targetId: string) => void;
}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? "light"];
  const isManager = message.sender.role !== "DRIVER";
  const isDeleted = !!message.deletedAt;
  const time = formatTime(message.createdAt, { hour: "2-digit", minute: "2-digit" });

  // Cluster sidekick — Trigger (mine / idle) + others' emojis inline.
  const sidekick =
    isDeleted || message.isSystem ? null : (
      <MessageReactionsCluster
        type="TRIP"
        targetId={message.id}
        reactions={message.reactions ?? []}
        currentUserId={currentUserId}
      />
    );

  return (
    <View
      style={[
        styles.bubbleRow,
        isMe ? styles.bubbleRowMe : styles.bubbleRowOther,
      ]}
    >
      {!isMe && (
        <View
          style={[
            styles.avatar,
            { backgroundColor: isManager ? c.primary : c.muted },
          ]}
        >
          <Ionicons
            name={isManager ? "headset-outline" : "person-outline"}
            size={12}
            color={isManager ? "#fff" : c.mutedForeground}
          />
        </View>
      )}
      <View style={styles.bubbleCol}>
        {!isMe && (
          <Text style={[styles.bubbleSender, { color: c.mutedForeground }]}>
            {fullName(message.sender) ||
              (isManager ? t("nav.manager") : t("nav.driverFallback"))}
          </Text>
        )}
        <View style={styles.bubbleInlineRow}>
          {isMe && sidekick}
          <Pressable
            onLongPress={onLongPress ? () => onLongPress(message) : undefined}
            delayLongPress={350}
            style={[
              styles.bubble,
              isMe
                ? {
                    backgroundColor: c.primary,
                    borderBottomRightRadius: 4,
                    borderBottomLeftRadius: Radius.lg,
                  }
                : {
                    backgroundColor: c.card,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: c.border,
                    borderBottomLeftRadius: 4,
                  },
              highlighted && { borderWidth: 2, borderColor: c.primary },
            ]}
          >
            {message.replyTo && (
              <MessageQuote
                senderName={fullName(message.replyTo.sender)}
                content={message.replyTo.content}
                isDeleted={!!message.replyTo.deletedAt}
                onPress={() => onReplyJump(message.replyTo!.id)}
                variant={isMe ? "onPrimary" : "default"}
              />
            )}
            {message.replyToDocument && (
              <MessageQuote
                kind="doc"
                senderName={fullName(message.replyToDocument.uploader)}
                fileName={message.replyToDocument.fileName}
                content=""
                isDeleted={!!message.replyToDocument.deletedAt}
                onPress={() => onReplyJump(message.replyToDocument!.id)}
                variant={isMe ? "onPrimary" : "default"}
              />
            )}
            <Text
              style={[
                styles.bubbleText,
                { color: isMe ? "#fff" : c.foreground },
              ]}
            >
              {(() => {
                const { subject, body } = splitBroadcastSubject(message.content);
                if (subject === null) return message.content;
                return (
                  <>
                    <Text style={{ fontWeight: "700" }}>{subject}</Text>
                    {"\n\n" + body}
                  </>
                );
              })()}
            </Text>
          </Pressable>
          {!isMe && sidekick}
        </View>
        <View style={styles.bubbleMetaRow}>
          {message.editedAt && (
            <Text style={[styles.bubbleTime, { color: c.mutedForeground, fontStyle: "italic" }]}>
              {t("chat.editedShort")}
            </Text>
          )}
          <Text style={[styles.bubbleTime, { color: c.mutedForeground }]}>
            {time}
          </Text>
          {isMe && (
            <Text
              style={[
                styles.bubbleTick,
                { color: message.isRead ? c.primary : c.mutedForeground },
              ]}
            >
              {message.isRead ? "✓✓" : "✓"}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
});

// ─── Trip docs modal (folder button → tabs) ─────────────────────────────────

type DocTab = "ALL" | "PHOTO" | "DOCUMENT";

function TripDocsModal({
  open,
  onClose,
  docs,
  onUpload,
  uploading,
  onOpenDoc,
}: {
  open: boolean;
  onClose: () => void;
  docs: DriverDocument[];
  onUpload: () => void;
  uploading: boolean;
  onOpenDoc: (d: DriverDocument) => void;
}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? "light"];
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<DocTab>("ALL");

  const photos = docs.filter((d) => d.fileType === "PHOTO");
  const documents = docs.filter((d) => d.fileType === "DOCUMENT");
  const filtered = tab === "ALL" ? docs : tab === "PHOTO" ? photos : documents;
  const counts = {
    ALL: docs.length,
    PHOTO: photos.length,
    DOCUMENT: documents.length,
  };

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={[
            styles.docsHeader,
            {
              backgroundColor: c.card,
              borderBottomColor: c.border,
              paddingTop: insets.top + Spacing.sm,
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [
              { opacity: pressed ? 0.6 : 1, padding: 4 },
            ]}
          >
            <Ionicons name="close" size={24} color={c.foreground} />
          </Pressable>
          <Text style={[styles.docsTitle, { color: c.foreground }]}>
            {t("trip.docsTitle")}
          </Text>
          <Pressable
            onPress={onUpload}
            disabled={uploading}
            hitSlop={8}
            style={({ pressed }) => [
              styles.uploadBtn,
              {
                backgroundColor: c.primary,
                opacity: pressed || uploading ? 0.85 : 1,
              },
            ]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
            )}
            <Text style={styles.uploadText}>{t("common.upload")}</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={[styles.docsTabs, { borderBottomColor: c.border }]}>
          {(["ALL", "PHOTO", "DOCUMENT"] as DocTab[]).map((tabKey) => {
            const active = tabKey === tab;
            const label =
              tabKey === "ALL"
                ? t("documents.tabs.all")
                : tabKey === "PHOTO"
                  ? t("documents.tabs.photos")
                  : t("documents.tabs.documents");
            return (
              <Pressable
                key={tabKey}
                onPress={() => setTab(tabKey)}
                style={[
                  styles.docsTab,
                  active && {
                    borderBottomColor: c.primary,
                    borderBottomWidth: 2,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.docsTabText,
                    {
                      color: active ? c.primary : c.mutedForeground,
                      fontWeight: active ? "700" : "500",
                    },
                  ]}
                >
                  {label} ({counts[tabKey]})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: c.mutedForeground }}>{t("documents.nothingHere")}</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(d) => d.id}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onOpenDoc(item)}
                style={({ pressed }) => [
                  styles.docRow,
                  {
                    backgroundColor: c.card,
                    borderColor: c.border,
                    borderRadius: Radius.md,
                    opacity: pressed ? 0.92 : 1,
                  },
                ]}
              >
                {item.fileType === "PHOTO" ? (
                  <Image
                    source={{ uri: item.signedUrl }}
                    style={styles.docRowThumb}
                  />
                ) : (
                  <View
                    style={[
                      styles.docRowThumb,
                      {
                        backgroundColor: c.muted,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    ]}
                  >
                    <Ionicons
                      name="document-text-outline"
                      size={24}
                      color={c.mutedForeground}
                    />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.docFileName, { color: c.foreground }]}
                    numberOfLines={2}
                  >
                    {item.fileName}
                  </Text>
                  <Text
                    style={[styles.docFileMeta, { color: c.mutedForeground }]}
                  >
                    {formatDate(item.createdAt)}
                    {fullName(item.uploader) ? ` · ${fullName(item.uploader)}` : ""}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Doc bubble (inline file in chat timeline) ──────────────────────────────

const DocBubble = memo(function DocBubble({
  doc,
  isMe,
  highlighted,
  onOpen,
  onLongPress,
}: {
  doc: DriverDocument;
  isMe: boolean;
  highlighted?: boolean;
  onOpen: (d: DriverDocument) => void;
  onLongPress?: (d: DriverDocument) => void;
}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? "light"];
  const isPhoto = doc.fileType === "PHOTO";
  const time = formatTime(doc.createdAt, { hour: "2-digit", minute: "2-digit" });
  const isManager = doc.uploader?.role !== "DRIVER";
  const ext = doc.fileName.split(".").pop()?.toUpperCase() ?? "FILE";

  return (
    <View
      style={[
        styles.bubbleRow,
        isMe ? styles.bubbleRowMe : styles.bubbleRowOther,
      ]}
    >
      {!isMe && (
        <View
          style={[
            styles.avatar,
            { backgroundColor: isManager ? c.primary : c.muted },
          ]}
        >
          <Ionicons
            name={isManager ? "headset-outline" : "person-outline"}
            size={12}
            color={isManager ? "#fff" : c.mutedForeground}
          />
        </View>
      )}
      <View style={styles.bubbleCol}>
        {!isMe && (
          <Text style={[styles.bubbleSender, { color: c.mutedForeground }]}>
            {fullName(doc.uploader) ||
              (isManager ? t("nav.manager") : t("nav.driverFallback"))}
          </Text>
        )}
        <Pressable
          onPress={() => onOpen(doc)}
          onLongPress={onLongPress ? () => onLongPress(doc) : undefined}
          delayLongPress={350}
          style={
            highlighted
              ? { borderWidth: 2, borderColor: c.primary, borderRadius: Radius.md }
              : undefined
          }
        >
          {isPhoto ? (
            <Image source={{ uri: doc.signedUrl }} style={styles.docThumb} />
          ) : (
            <View
              style={[
                styles.docBubble,
                isMe
                  ? { backgroundColor: c.primary }
                  : {
                      backgroundColor: c.card,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: c.border,
                    },
              ]}
            >
              <Ionicons
                name="document-text-outline"
                size={20}
                color={isMe ? "#fff" : c.foreground}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.docFileName,
                    { color: isMe ? "#fff" : c.foreground },
                  ]}
                  numberOfLines={2}
                >
                  {doc.fileName}
                </Text>
                <Text
                  style={[
                    styles.docFileMeta,
                    {
                      color: isMe ? "rgba(255,255,255,0.7)" : c.mutedForeground,
                    },
                  ]}
                >
                  {ext}
                </Text>
              </View>
            </View>
          )}
        </Pressable>
        <View style={styles.bubbleMetaRow}>
          <Text style={[styles.bubbleTime, { color: c.mutedForeground }]}>
            {time}
          </Text>
          {isMe && (
            <Text
              style={[
                styles.bubbleTick,
                { color: doc.isRead ? c.primary : c.mutedForeground },
              ]}
            >
              {doc.isRead ? "✓✓" : "✓"}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
});

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
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? "light"];
  const [collapsed, setCollapsed] = useState(false);
  const loading = trip.stops.filter((s) => s.type === "LOADING");
  const unloading = trip.stops.filter((s) => s.type === "UNLOADING");

  return (
    <View
      style={[
        styles.card,
        // Soft muted fill so the trip/address panel reads as separate from
        // the chat below without a hard divider.
        { backgroundColor: c.muted, borderBottomColor: c.border },
      ]}
    >
      {/* Header row — tap to collapse */}
      <Pressable
        onPress={() => setCollapsed((v) => !v)}
        style={styles.cardHeader}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.cardTitle, { color: c.foreground }]}
            numberOfLines={collapsed ? 1 : 2}
          >
            {trip.title}
          </Text>
          {trip.orderNumber ? (
            <Text style={[styles.cardSub, { color: c.mutedForeground }]}>
              #{trip.orderNumber}
            </Text>
          ) : null}
        </View>
        <View style={[styles.collapseBtn, { backgroundColor: c.primary + "1A", borderColor: c.primary + "40" }]}>
          <Ionicons
            name={collapsed ? "chevron-down" : "chevron-up"}
            size={22}
            color={c.primary}
          />
        </View>
      </Pressable>

      {!collapsed && (
        <>
          {loading.length > 0 && (
            <StopsBlock label={t("trip.stops.loading")} color="#10B981" stops={loading} />
          )}
          {unloading.length > 0 && (
            <StopsBlock label={t("trip.stops.unloading")} color="#f87171" stops={unloading} />
          )}
          {trip.notes ? (
            <View style={[styles.notes, { borderTopColor: c.border }]}>
              <Text style={[styles.notesText, { color: "#dc2626" }]}>
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

async function copyToClipboard(value: string) {
  try {
    await Clipboard.setStringAsync(value);
  } catch {
    /* swallow — copy is a nice-to-have, never crash the chat for it */
  }
}

function openInMaps(coords: string) {
  const trimmed = coords.trim();
  if (!trimmed) return;
  // Apple Maps + Google Maps both honour `?q=lat,lng` — universal URL.
  const url = `https://www.google.com/maps?q=${encodeURIComponent(trimmed)}`;
  Linking.openURL(url).catch(() => {});
}

function StopsBlock({
  label,
  color,
  stops,
}: {
  label: string;
  color: string;
  stops: Trip["stops"];
}) {
  const c = Colors[useColorScheme() ?? "light"];
  return (
    <View style={styles.stopsBlock}>
      <View style={styles.stopsHeader}>
        <Ionicons name="location-outline" size={13} color={color} />
        <Text style={[styles.stopsLabel, { color }]}>
          {label} ({stops.length})
        </Text>
      </View>
      {stops.map((s, i) => (
        <View key={s.id} style={styles.stopCard}>
          <View style={styles.stopRow}>
            <Text style={[styles.stopIndex, { color: c.mutedForeground }]}>
              {i + 1}.
            </Text>
            {/* Tap anywhere on the address to copy. The icon button is the
                discoverable affordance; selectable would intercept the tap
                on Android, so we keep it off. */}
            <Pressable
              onPress={() => s.address && copyToClipboard(s.address)}
              style={styles.stopAddressWrap}
              hitSlop={6}
            >
              <Text
                style={[styles.stopAddress, { color: c.foreground }]}
                numberOfLines={3}
              >
                {s.address ?? "—"}
              </Text>
            </Pressable>
            {s.address ? (
              <Pressable
                onPress={() => copyToClipboard(s.address!)}
                hitSlop={10}
                style={({ pressed }) => [
                  styles.addrCopyBtn,
                  { backgroundColor: pressed ? c.muted : "transparent" },
                ]}
              >
                <Ionicons name="copy-outline" size={18} color={c.foreground} />
              </Pressable>
            ) : null}
          </View>
          {(s.ref || s.coords) && (
            <View style={styles.stopMetaRow}>
              {s.ref ? (
                <Pressable
                  onPress={() => copyToClipboard(s.ref!)}
                  style={({ pressed }) => [
                    styles.metaChip,
                    {
                      borderColor: c.border,
                      backgroundColor: pressed ? c.muted : "transparent",
                    },
                  ]}
                  hitSlop={6}
                >
                  <Text style={[styles.metaLabel, { color: c.foreground }]}>
                    ref:
                  </Text>
                  <Text
                    style={[styles.metaText, { color: c.foreground }]}
                    numberOfLines={1}
                    selectable
                  >
                    {s.ref}
                  </Text>
                  <Ionicons
                    name="copy-outline"
                    size={16}
                    color={c.foreground}
                  />
                </Pressable>
              ) : null}
              {s.coords ? (
                <View style={[styles.metaChip, { borderColor: c.border }]}>
                  <Ionicons
                    name="navigate-outline"
                    size={14}
                    color={c.foreground}
                  />
                  <Text
                    style={[styles.metaText, { color: c.foreground }]}
                    numberOfLines={1}
                    selectable
                  >
                    {s.coords}
                  </Text>
                  <Pressable
                    onPress={() => copyToClipboard(s.coords!)}
                    hitSlop={10}
                    style={({ pressed }) => [
                      styles.metaActionBtn,
                      { backgroundColor: pressed ? c.muted : "transparent" },
                    ]}
                  >
                    <Ionicons
                      name="copy-outline"
                      size={16}
                      color={c.foreground}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => openInMaps(s.coords!)}
                    hitSlop={10}
                    style={({ pressed }) => [
                      styles.metaActionBtn,
                      { backgroundColor: pressed ? c.muted : "transparent" },
                    ]}
                  >
                    <Ionicons
                      name="open-outline"
                      size={16}
                      color={c.foreground}
                    />
                  </Pressable>
                </View>
              ) : null}
            </View>
          )}
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
  const c = Colors[useColorScheme() ?? "light"];
  const navigation = useNavigation();
  const { top } = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: c.card,
          borderBottomColor: c.border,
          paddingTop: top + Spacing.sm,
        },
      ]}
    >
      <View style={styles.row}>
        <Pressable
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          hitSlop={8}
          style={({ pressed }) => [
            styles.menuBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="menu" size={24} color={c.foreground} />
        </Pressable>

        <View style={styles.truckBlock}>
          {truck ? (
            <>
              <MaterialCommunityIcons
                name="truck-outline"
                size={20}
                color={c.foreground}
              />
              <Text style={[styles.truck, { color: c.foreground }]}>
                {truck}
              </Text>
            </>
          ) : null}
          {/* Full notification bell — trip + DM unread, with a preview panel
              (same as the sidebar bell). */}
          <NotificationBell colors={c} />
        </View>

        {canEditStatus ? (
          <StatusPicker value={status} onChange={onChangeStatus} />
        ) : (
          <View style={{ opacity: 0.5 }}>
            <StatusPicker value={status} onChange={() => {}} />
          </View>
        )}

        <Text
          style={[styles.driver, { color: c.mutedForeground }]}
          numberOfLines={1}
        >
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
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  menuBtn: { padding: 4 },
  truckBlock: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  truck: { fontSize: 16, fontWeight: "700" },
  driver: { flex: 1, textAlign: "right", fontSize: 14, fontWeight: "500" },
  bellWrap: {
    position: "relative",
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: -3,
    right: -4,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#f87171",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  bellBadgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "700",
    lineHeight: 10,
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  nextStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderLeftWidth: 3,
    borderRadius: Radius.sm,
  },
  nextStripTitle: { fontSize: 13, fontWeight: "600" },
  nextStripHint: { fontSize: 11, marginTop: 1 },

  // Trip info card
  card: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, fontFamily: "monospace", marginTop: 2 },

  stopsBlock: { gap: 8 },
  stopsHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  stopsLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  stopCard: { gap: 6, paddingVertical: 2 },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 2,
  },
  stopIndex: { fontSize: 13, fontWeight: "600", minWidth: 16, marginTop: 1 },
  stopAddressWrap: { flex: 1 },
  stopAddress: { fontSize: 13 },
  addrCopyBtn: {
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  stopMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingLeft: 22,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    maxWidth: "100%",
  },
  metaActionBtn: {
    padding: 4,
    marginLeft: 2,
    borderRadius: 6,
  },
  collapseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  metaText: { fontSize: 13, fontFamily: "monospace" },
  metaLabel: { fontSize: 13, fontWeight: "600" },

  notes: { paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  notesText: { fontSize: 12, fontStyle: "italic" },

  // Chat
  chatWrap: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  chatLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  chatLabelText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
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
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  emptyChatText: { fontSize: 13, textAlign: "center" },
  // flex:1 constrains FlatList within chatWrap — without it, FlatList expands
  // to full content height, overflows the parent, and its scroll area swallows
  // all taps to the inputWrap below it (iOS) or pushes input off screen (Android)
  messageListFlex: { flex: 1 },
  scrollDownBtn: {
    position: "absolute",
    alignSelf: "center",
    bottom: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    // Without horizontal anchors Yoga can stretch an absolute frame to the
    // full parent width on iOS — give it a fixed minimum so the hit area
    // is exactly the pill content, never a hidden full-width row.
    minWidth: 90,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  scrollDownText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  messageList: {
    padding: Spacing.md,
    gap: Spacing.sm,
    paddingBottom: Spacing.lg,
  },

  // System notices (handover events, etc.)
  systemRow: {
    alignItems: "center",
    marginVertical: 6,
  },
  systemText: {
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  inactiveNotice: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 12,
    textAlign: "center",
  },
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  typingText: {
    fontSize: 11,
  },

  // Bubbles
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginBottom: 6,
  },
  bubbleRowMe: { justifyContent: "flex-end" },
  bubbleRowOther: { justifyContent: "flex-start" },
  bubbleCol: { maxWidth: "75%", gap: 2 },
  // Inline row that hosts the bubble + reactions trigger so the trigger
  // is vertically centred on the bubble (not on bubble + meta together).
  bubbleInlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  bubbleBarWrap: { marginTop: 3 },
  bubbleBarWrapMe: { alignItems: "flex-end" },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  bubbleSender: { fontSize: 10, fontWeight: "600", paddingLeft: 4 },
  bubbleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 4,
  },
  bubbleTick: { fontSize: 10, fontWeight: "700" },
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.lg,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTime: { fontSize: 10 },

  // Input bar
  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyBannerBar: { width: 2, alignSelf: "stretch", borderRadius: 1 },
  replyBannerTitle: { fontSize: 11, fontWeight: "600" },
  replyBannerText: { fontSize: 11, marginTop: 1 },
  input: {
    flex: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  folderBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  // TripDocsModal
  docsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  docsTitle: { flex: 1, fontSize: 16, fontWeight: "700" },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },
  uploadText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  docsTabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  docsTab: { flex: 1, paddingVertical: Spacing.md, alignItems: "center" },
  docsTabText: { fontSize: 13 },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  docRowThumb: { width: 56, height: 56, borderRadius: Radius.sm },
  // Doc bubble
  docBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.lg,
    minWidth: 160,
  },
  docThumb: {
    width: 160,
    height: 120,
    borderRadius: Radius.md,
  },
  docFileName: { fontSize: 13, fontWeight: "600" },
  docFileMeta: { fontSize: 10, marginTop: 2 },
});
