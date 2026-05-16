import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  DrawerActions,
  useIsFocused,
  useNavigation,
} from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
import EmojiPicker from "rn-emoji-keyboard";

import { ScreenPlaceholder } from "@/components/screen-placeholder";
import { StatusPicker } from "@/components/status-picker";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { TripStatus } from "@/constants/trip-status";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useTripDocuments, useUploadDocuments } from "@/hooks/use-documents";
import { useDriverUnread } from "@/hooks/use-driver-unread";
import { ChatMessage, useTripChat } from "@/hooks/use-trip-chat";
import {
  useActiveTrip,
  useTrip,
  useUpdateMyTripStatus,
} from "@/hooks/use-trips";
import { DriverDocument, UploadFileLocal } from "@/lib/documents-api";
import { Trip } from "@/lib/types";
import { useUser } from "@/store/auth";

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TripScreen() {
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
  const { data: unreadData } = useDriverUnread();
  const router = useRouter();

  // Bell tap → jump to the trip with unread messages. Picks the active trip
  // first; otherwise the first item (most recent past trip with unread).
  const handleBellPress = () => {
    const items = unreadData?.items ?? [];
    if (items.length === 0) return;
    const target = items.find((it) => it.isActiveTrip) ?? items[0];
    if (target.isActiveTrip) {
      router.replace("/(driver)/trip");
    } else {
      router.push({
        pathname: "/(driver)/trip",
        params: { tripId: target.tripId },
      });
    }
  };

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
  const driverName = trip?.driver?.name ?? user?.name ?? "Driver";
  const status: TripStatus = trip?.status ?? "ASSIGNED";

  return (
    // KAV at root so offset is always 0 (nothing above it).
    // iOS 'padding' — adds paddingBottom = keyboard height, content compresses.
    // Android 'height' — reduces KAV height; needed because edgeToEdgeEnabled
    //   disables the OS-level adjustResize, so we must do it ourselves.
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <TripHeader
        truck={truckPlate ?? ""}
        driver={driverName}
        status={status}
        onChangeStatus={handleStatusChange}
        canEditStatus={!!trip}
        unreadCount={unreadData?.total}
        onBellPress={handleBellPress}
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
            title="No active trip"
            subtitle="When your manager assigns a trip, it'll show up here. Pull down to refresh."
          />
        </ScrollView>
      ) : (
        <TripWithChat
          trip={trip}
          onRefresh={handleManualRefresh}
          refreshing={manualRefreshing}
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
}: {
  trip: Trip;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const c = Colors[useColorScheme() ?? "light"];
  const user = useUser();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const [text, setText] = useState("");
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
    sendMessage,
    deleteMessage,
    removeDocument,
    markReadNow,
    typers,
    notifyTyping,
    notifyStopTyping,
  } = useTripChat(trip.id, { isFocused, nearBottomRef });
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

  // Track keyboard so the input doesn't keep its safe-area paddingBottom
  // while the keyboard is up (KAV already lifts the input above the keyboard;
  // the home-indicator inset is only relevant when the keyboard is closed).
  // Also: when the keyboard opens, snap the message list to the bottom so
  // the last message stays visible above the input instead of getting hidden
  // behind it.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvt, () => {
      setKbOpen(true);
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
    const hideSub = Keyboard.addListener(hideEvt, () => setKbOpen(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Auto-scroll when new timeline items arrive (messages OR docs), but only
  // if the user is already near the bottom.
  // • First scroll: instant (no visible scroll-from-top animation).
  // • Subsequent scrolls (new messages): animated glide.
  // • Android: the FlatList layout pass often completes AFTER this effect fires
  //   on initial load, so we skip if not yet laid out — onLayout will call
  //   the initial scroll instead once the list is ready.
  useEffect(() => {
    if (timeline.length === 0) return;
    if (!listLaidOut.current) return; // onLayout will handle the first scroll
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
    } else if (initialScrollDone.current) {
      // User has scrolled up to read history — show "↓ N new" pill instead
      // of yanking them back down (Viber/Telegram pattern).
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
    setText("");
    sendMessage(trimmed);
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
      Alert.alert("Upload failed", (e as Error).message);
    }
  };

  const showUploadSheet = () => {
    Alert.alert("Attach", "Choose source", [
      { text: "Camera", onPress: () => pickAndUpload("camera") },
      { text: "Gallery", onPress: () => pickAndUpload("gallery") },
      { text: "File", onPress: () => pickAndUpload("document") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleOpenDoc = async (doc: DriverDocument) => {
    try {
      await WebBrowser.openBrowserAsync(doc.signedUrl);
    } catch (e) {
      Alert.alert("Cannot open", (e as Error).message);
    }
  };

  const confirmDeleteMessage = (id: string) => {
    Alert.alert("Delete message?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMessage(id),
      },
    ]);
  };

  const confirmDeleteDoc = (doc: DriverDocument) => {
    Alert.alert("Delete file?", `${doc.fileName} will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => removeDocument(doc.id),
      },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Trip info — collapses to make room for chat */}
      <TripInfoCard trip={trip} onRefresh={onRefresh} refreshing={refreshing} />

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
            Trip chat
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
            {connected ? "online" : "connecting…"}
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
              No messages yet. Start the conversation.
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
            }}
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
            renderItem={({ item }) => {
              if (item.kind === "msg") {
                // System events (driver/manager changed) — Telegram-style
                // centered grey label, no avatar/bubble.
                if (item.data.isSystem) {
                  return <SystemNotice text={item.data.content} />;
                }
                const isMe = item.data.senderId === user?.id;
                return (
                  <MessageBubble
                    message={item.data}
                    isMe={isMe}
                    onLongPress={
                      isMe
                        ? () => confirmDeleteMessage(item.data.id)
                        : undefined
                    }
                  />
                );
              }
              const isMe = item.data.uploadedBy === user?.id;
              return (
                <DocBubble
                  doc={item.data}
                  isMe={isMe}
                  onOpen={() => handleOpenDoc(item.data)}
                  onLongPress={
                    isMe ? () => confirmDeleteDoc(item.data) : undefined
                  }
                />
              );
            }}
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
            <Text style={styles.scrollDownText}>{newMsgCount} new</Text>
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
            {typers.size === 1 ? "набирає" : "набирають"}
          </Text>
          <TypingDots color={c.mutedForeground} />
        </View>
      )}

      {/* Input bar — moved OUT of chatWrap so the FlatList's iOS scroll-content
          rect can never extend over the TextInput's hit area.
          paddingBottom: safe area when keyboard closed, small when keyboard open. */}
      {!isActiveDriver ? (
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: c.card,
              borderTopColor: c.border,
              paddingBottom: kbOpen
                ? Spacing.sm
                : Math.max(insets.bottom, Spacing.sm),
              justifyContent: "center",
            },
          ]}
        >
          <Text style={[styles.inactiveNotice, { color: c.mutedForeground }]}>
            Ви більше не учасник цього чату — перегляд тільки для читання.
          </Text>
        </View>
      ) : (
        <View
          style={[
            styles.inputWrap,
            {
              backgroundColor: c.card,
              borderTopColor: c.border,
              paddingBottom: kbOpen
                ? Spacing.sm
                : Math.max(insets.bottom, Spacing.sm),
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
            placeholder="Message…"
            placeholderTextColor={c.mutedForeground}
            style={[
              styles.input,
              { color: c.foreground, backgroundColor: c.muted },
            ]}
            multiline
            maxLength={1000}
            // NB: do NOT add `blurOnSubmit={false}` or `returnKeyType` on a
            // multiline TextInput in Expo Go iOS — that combo regresses the
            // input so typed characters never reach onChangeText. Same bug
            // we already chased twice (d38c26c, c56bcf1). Native defaults
            // for multiline already keep the keyboard open on Enter and
            // insert a newline; the dedicated Send button does the commit.
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
      )}

      <EmojiPicker
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onEmojiSelected={(e) => setText((t) => t + e.emoji)}
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

function SystemNotice({ text }: { text: string }) {
  const c = Colors[useColorScheme() ?? "light"];
  return (
    <View style={styles.systemRow}>
      <Text
        style={[
          styles.systemText,
          { color: c.mutedForeground, backgroundColor: c.muted },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isMe,
  onLongPress,
}: {
  message: ChatMessage;
  isMe: boolean;
  onLongPress?: () => void;
}) {
  const c = Colors[useColorScheme() ?? "light"];
  const isManager = message.sender.role !== "DRIVER";
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

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
            {message.sender.name ?? (isManager ? "Manager" : "Driver")}
          </Text>
        )}
        <Pressable
          onLongPress={onLongPress}
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
          ]}
        >
          <Text
            style={[styles.bubbleText, { color: isMe ? "#fff" : c.foreground }]}
          >
            {message.content}
          </Text>
        </Pressable>
        <View style={styles.bubbleMetaRow}>
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
}

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
            Trip documents
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
            <Text style={styles.uploadText}>Upload</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={[styles.docsTabs, { borderBottomColor: c.border }]}>
          {(["ALL", "PHOTO", "DOCUMENT"] as DocTab[]).map((t) => {
            const active = t === tab;
            const label =
              t === "ALL" ? "All" : t === "PHOTO" ? "Photos" : "Documents";
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
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
                  {label} ({counts[t]})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: c.mutedForeground }}>Nothing here yet.</Text>
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
                    {new Date(item.createdAt).toLocaleDateString()}
                    {item.uploader?.name ? ` · ${item.uploader.name}` : ""}
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

function DocBubble({
  doc,
  isMe,
  onOpen,
  onLongPress,
}: {
  doc: DriverDocument;
  isMe: boolean;
  onOpen: () => void;
  onLongPress?: () => void;
}) {
  const c = Colors[useColorScheme() ?? "light"];
  const isPhoto = doc.fileType === "PHOTO";
  const time = new Date(doc.createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
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
            {doc.uploader?.name ?? (isManager ? "Manager" : "Driver")}
          </Text>
        )}
        <Pressable
          onPress={onOpen}
          onLongPress={onLongPress}
          delayLongPress={350}
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
  const c = Colors[useColorScheme() ?? "light"];
  const [collapsed, setCollapsed] = useState(false);
  const loading = trip.stops.filter((s) => s.type === "LOADING");
  const unloading = trip.stops.filter((s) => s.type === "UNLOADING");

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderBottomColor: c.border },
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
        <Ionicons
          name={collapsed ? "chevron-down" : "chevron-up"}
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
            <StopsBlock label="Unloading" color="#f87171" stops={unloading} />
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
  unreadCount,
  onBellPress,
}: {
  truck: string;
  driver: string;
  status: TripStatus;
  onChangeStatus: (s: TripStatus) => void;
  canEditStatus: boolean;
  unreadCount?: number;
  onBellPress?: () => void;
}) {
  const c = Colors[useColorScheme() ?? "light"];
  const navigation = useNavigation();
  const { top } = useSafeAreaInsets();
  const hasUnread = (unreadCount ?? 0) > 0;
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
          {/* unread bell badge — tap jumps to the trip with unread messages */}
          <Pressable
            onPress={hasUnread ? onBellPress : undefined}
            disabled={!hasUnread}
            hitSlop={8}
            style={({ pressed }) => [
              styles.bellWrap,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons
              name="notifications-outline"
              size={18}
              color={hasUnread ? "#f87171" : c.mutedForeground}
            />
            {hasUnread && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>
                  {unreadCount! > 99 ? "99+" : unreadCount}
                </Text>
              </View>
            )}
          </Pressable>
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
