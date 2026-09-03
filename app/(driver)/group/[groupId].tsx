import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import EmojiPicker from 'rn-emoji-keyboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Stable KeyboardAvoidingView for new arch + edge-to-edge (RN's built-in one
// lets the input jump). Requires <KeyboardProvider> in app/_layout.tsx.
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { NotificationBell } from '@/components/notification-bell';
import { MessageActionsSheet, type MessageActions } from '@/components/message-actions-sheet';
import { UserCardSheet } from '@/components/user-card-sheet';
import { MessageQuote } from '@/components/message-quote';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChatEvents, useJoinGroupRoom } from '@/hooks/use-chat-events';
import {
  useDeleteGroupDoc,
  useGroupDocsSocketSync,
  useGroupDocuments,
  useUploadGroupDocs,
  type GroupDocumentFull,
} from '@/hooks/use-group-documents';
import {
  useDeleteGroupMessage,
  useEditGroupMessage,
  useGroupMessages,
  useLoadOlderGroupMessages,
  useMarkGroupRead,
  type GroupMessage,
} from '@/hooks/use-groups';
import { MessageReactionsCluster } from '@/components/message-reactions';
import { useReactionsSocketSync } from '@/hooks/use-message-reactions';
import { EDIT_WINDOW_MS } from '@/lib/constants';
import { fullName } from '@/lib/format';
import { formatDate, formatTime } from '@/lib/format-date';
import { getSocket } from '@/lib/socket';
import { useUser } from '@/store/auth';

type ReplyTarget = {
  id: string;
  targetType: 'msg' | 'doc';
  senderName: string | null;
  content: string;
  isDeleted: boolean;
};

type EditingState = { id: string; original: string };

// Chat + documents share one time-ordered timeline.
type TimelineItem =
  | { kind: 'msg'; data: GroupMessage; ts: number }
  | { kind: 'doc'; data: GroupDocumentFull; ts: number };

export default function GroupChatScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { groupId, name } = useLocalSearchParams<{ groupId: string; name?: string }>();
  const me = useUser();
  const myId = me?.id ?? '';

  // Pushed from the Chat screen's Groups tab but lives as a drawer route, so a
  // plain back pops to the drawer's initial screen (Trips). Step back to the
  // Groups tab explicitly — for the header chevron and Android hardware back.
  const goBackToGroups = () =>
    router.navigate({ pathname: '/(driver)/chat', params: { tab: 'groups' } });
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.navigate({ pathname: '/(driver)/chat', params: { tab: 'groups' } });
      return true;
    });
    return () => sub.remove();
  }, []);

  // ─── Data ──────────────────────────────────────────────────────────
  const { data: messages = [], isLoading } = useGroupMessages(groupId);
  const { loadOlder, loadingOlder, hasMore } = useLoadOlderGroupMessages(groupId);
  const { data: documents = [] } = useGroupDocuments(groupId);
  const deleteMsg = useDeleteGroupMessage();
  const editMsg = useEditGroupMessage(groupId);
  const markRead = useMarkGroupRead();
  const uploadDocs = useUploadGroupDocs(groupId);
  const deleteDoc = useDeleteGroupDoc(groupId);

  // ─── Realtime ──────────────────────────────────────────────────────
  useJoinGroupRoom(groupId);
  useChatEvents({ groupId, myUserId: myId });
  useGroupDocsSocketSync(groupId);
  useReactionsSocketSync({ groupId });

  // Mark the whole group read on open and whenever a new message lands —
  // but only while the screen is focused. The drawer keeps it mounted after
  // you leave, so without the focus gate it would keep ack'ing new messages.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (groupId && isFocused) markRead.mutate(groupId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, messages.length, isFocused]);

  // ─── Composer state ────────────────────────────────────────────────
  const [text, setText] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);

  // Photo viewer + documents folder overlays.
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);

  // ─── Long-press actions sheet ──────────────────────────────────────
  const [sheetFor, setSheetFor] = useState<GroupMessage | null>(null);
  const [docSheetFor, setDocSheetFor] = useState<GroupDocumentFull | null>(null);

  // Live (non-deleted) docs power the folder count + the folder modal.
  const liveDocs = useMemo(() => documents.filter((d) => !d.deletedAt), [documents]);

  // ─── List — messages + documents merged into one timeline ──────────
  const listRef = useRef<FlatList<TimelineItem>>(null);
  const data = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...messages.map((m) => ({
        kind: 'msg' as const,
        data: m,
        ts: new Date(m.createdAt).getTime(),
      })),
      ...documents.map((d) => ({
        kind: 'doc' as const,
        data: d,
        ts: new Date(d.createdAt).getTime(),
      })),
    ];
    // Newest first for the inverted list.
    return items.sort((a, b) => b.ts - a.ts);
  }, [messages, documents]);

  // ─── Jump to a replied-to message/document ─────────────────────────
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [cardUserId, setCardUserId] = useState<string | null>(null);
  const scrollToMessage = useCallback(
    (targetId?: string | null) => {
      if (!targetId) return;
      const index = data.findIndex((it) => it.data.id === targetId);
      if (index < 0) return;
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      setHighlightId(targetId);
      setTimeout(
        () => setHighlightId((h) => (h === targetId ? null : h)),
        1500,
      );
    },
    [data],
  );

  // ─── Attach flow ───────────────────────────────────────────────────
  const pickAndUpload = async (source: 'camera' | 'gallery' | 'document') => {
    let files: { uri: string; name: string; type: string }[] = [];
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const r = await ImagePicker.launchCameraAsync({ quality: 0.8 });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? `photo-${Date.now()}.jpg`,
          type: a.mimeType ?? 'image/jpeg',
        }));
      } else if (source === 'gallery') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          quality: 0.8,
        });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? `photo-${Date.now()}.jpg`,
          type: a.mimeType ?? 'image/jpeg',
        }));
      } else {
        const r = await DocumentPicker.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
          type: '*/*',
        });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.name,
          type: a.mimeType ?? 'application/octet-stream',
        }));
      }
      if (files.length === 0) return;
      await uploadDocs.mutateAsync({ files });
    } catch (e) {
      Alert.alert(t('documents.uploadFailed'), (e as Error).message);
    }
  };

  const showAttachSheet = () => {
    Alert.alert(t('trip.attachSheet.title'), t('documents.uploadSheet.subtitle'), [
      { text: t('documents.uploadSheet.camera'), onPress: () => pickAndUpload('camera') },
      { text: t('documents.uploadSheet.gallery'), onPress: () => pickAndUpload('gallery') },
      { text: t('documents.uploadSheet.file'), onPress: () => pickAndUpload('document') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const openDoc = useCallback(
    async (doc: GroupDocumentFull) => {
      // Photos open instantly in an in-app viewer; other files hand off to the
      // system browser (PDF/doc preview).
      if (doc.fileType === 'PHOTO') {
        setViewerUri(doc.signedUrl);
        return;
      }
      try {
        await WebBrowser.openBrowserAsync(doc.signedUrl);
      } catch (e) {
        Alert.alert(t('documents.cannotOpen'), (e as Error).message);
      }
    },
    [t],
  );

  // Stable per-list callbacks so the memoized bubbles don't re-render on every
  // parent update (typing, presence ticks).
  const handleMsgLongPress = useCallback((m: GroupMessage) => setSheetFor(m), []);
  const handleDocLongPress = useCallback(
    (d: GroupDocumentFull) => setDocSheetFor(d),
    [],
  );

  // ─── Send / edit ───────────────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (editing) {
      if (trimmed === editing.original.trim()) {
        setEditing(null);
        setText('');
        return;
      }
      try {
        await editMsg.mutateAsync({ id: editing.id, content: trimmed });
      } finally {
        setEditing(null);
        setText('');
      }
      return;
    }

    const replyMsgId = replyingTo?.targetType === 'msg' ? replyingTo.id : null;
    const replyDocId = replyingTo?.targetType === 'doc' ? replyingTo.id : null;
    getSocket().emit('send_group_message', {
      groupId,
      content: trimmed,
      replyToId: replyMsgId,
      replyToDocumentId: replyDocId,
    });
    setText('');
    setReplyingTo(null);
  };

  // ─── Header ────────────────────────────────────────────────────────
  const groupName = name || t('chat.groupFallback');

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={0}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: c.card,
            borderBottomColor: c.border,
            paddingTop: insets.top + Spacing.xs,
          },
        ]}
      >
        <Pressable onPress={goBackToGroups} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </Pressable>
        <View style={[styles.headerAvatar, { backgroundColor: c.muted }]}>
          <Ionicons name="people" size={18} color={c.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.headerName, { color: c.foreground }]} numberOfLines={1}>
            {groupName}
          </Text>
          <Text style={[styles.headerRole, { color: c.mutedForeground }]} numberOfLines={1}>
            {t('chat.groupChat')}
          </Text>
        </View>
        {/* Quick access to all attachments — same pill as the Trip chat */}
        <Pressable
          onPress={() => setFolderOpen(true)}
          hitSlop={6}
          style={({ pressed }) => [styles.folderBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="folder-outline" size={16} color={c.mutedForeground} />
          <Text style={[styles.folderBtnText, { color: c.mutedForeground }]}>
            {liveDocs.length}
          </Text>
        </Pressable>
        <NotificationBell colors={c} />
      </View>

      {/* Messages */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={data}
          keyExtractor={(it) => `${it.kind}:${it.data.id}`}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews
          inverted
          contentContainerStyle={{ paddingVertical: Spacing.sm }}
          onScrollToIndexFailed={() => {}}
          // Tap on a message gap dismisses the keyboard; a scroll drag too.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // Inverted list → the "end" is the visual top: pull older history.
          onEndReachedThreshold={0.3}
          onEndReached={() => {
            if (hasMore && !loadingOlder) loadOlder();
          }}
          ListFooterComponent={
            loadingOlder ? (
              <View style={{ paddingVertical: Spacing.md }}>
                <ActivityIndicator size="small" color={c.mutedForeground} />
              </View>
            ) : null
          }
          renderItem={({ item }) =>
            item.kind === 'msg' ? (
              <GroupBubble
                msg={item.data}
                isOwn={item.data.senderId === myId}
                myId={myId}
                highlighted={item.data.id === highlightId}
                onLongPress={handleMsgLongPress}
                onReplyJump={scrollToMessage}
                onOpenUser={setCardUserId}
              />
            ) : (
              <DocBubble
                doc={item.data}
                isOwn={item.data.uploadedBy === myId}
                myId={myId}
                highlighted={item.data.id === highlightId}
                onOpen={openDoc}
                onLongPress={handleDocLongPress}
              />
            )
          }
        />
      )}

      {/* Reply banner */}
      {replyingTo && !editing && (
        <Banner kind="reply" target={replyingTo} onCancel={() => setReplyingTo(null)} />
      )}

      {/* Edit banner */}
      {editing && (
        <Banner
          kind="edit"
          target={{
            id: editing.id,
            targetType: 'msg',
            senderName: fullName(me) || null,
            content: editing.original,
            isDeleted: false,
          }}
          onCancel={() => {
            setEditing(null);
            setText('');
          }}
        />
      )}

      {/* Composer */}
      <View
        style={[
          styles.composer,
          {
            backgroundColor: c.card,
            borderTopColor: c.border,
            paddingBottom: Math.max(insets.bottom, Spacing.sm),
          },
        ]}
      >
        {!editing && (
          <Pressable
            onPress={showAttachSheet}
            disabled={uploadDocs.isPending}
            hitSlop={6}
            style={({ pressed }) => [
              styles.attachBtn,
              { opacity: pressed || uploadDocs.isPending ? 0.5 : 1 },
            ]}
          >
            {uploadDocs.isPending ? (
              <ActivityIndicator size="small" color={c.mutedForeground} />
            ) : (
              <Ionicons name="attach" size={24} color={c.mutedForeground} />
            )}
          </Pressable>
        )}
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setEmojiOpen(true);
          }}
          hitSlop={6}
          style={({ pressed }) => [
            styles.attachBtn,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="happy-outline" size={24} color={c.mutedForeground} />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={editing ? t('chat.editPlaceholder') : t('chat.messagePlaceholder')}
          placeholderTextColor={c.mutedForeground}
          style={[styles.input, { color: c.foreground, backgroundColor: c.muted }]}
          multiline
        />
        <Pressable
          onPress={handleSend}
          disabled={!text.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: c.primary,
              opacity: pressed ? 0.7 : text.trim() ? 1 : 0.4,
            },
          ]}
        >
          <Ionicons
            name={editing ? 'checkmark' : 'send'}
            size={18}
            color={c.primaryForeground}
          />
        </Pressable>
      </View>

      <EmojiPicker
        open={emojiOpen}
        onClose={() => setEmojiOpen(false)}
        onEmojiSelected={(e) => setText((prev) => prev + e.emoji)}
      />

      {/* Tap a sender's name → mini profile card */}
      <UserCardSheet userId={cardUserId} onClose={() => setCardUserId(null)}
      />

      {/* Long-press menu */}
      <MessageActionsSheet
        visible={!!sheetFor}
        onClose={() => setSheetFor(null)}
        actions={buildActions({
          msg: sheetFor,
          isOwn: sheetFor?.senderId === myId,
          onReply: (m) => {
            setReplyingTo({
              id: m.id,
              targetType: 'msg',
              senderName: fullName(m.sender) || null,
              content: m.content,
              isDeleted: !!m.deletedAt,
            });
            setEditing(null);
          },
          onCopy: (m) => Clipboard.setStringAsync(m.content),
          onEdit: (m) => {
            setEditing({ id: m.id, original: m.content });
            setText(m.content);
            setReplyingTo(null);
          },
          onDelete: (m) => deleteMsg.mutate(m.id),
        })}
      />

      {/* Long-press menu for a document — reply + delete only */}
      <MessageActionsSheet
        visible={!!docSheetFor}
        onClose={() => setDocSheetFor(null)}
        actions={{
          onReply: docSheetFor
            ? () => {
                const d = docSheetFor;
                setReplyingTo({
                  id: d.id,
                  targetType: 'doc',
                  senderName: fullName(d.uploader) || null,
                  content: d.caption || d.fileName,
                  isDeleted: false,
                });
                setEditing(null);
              }
            : undefined,
          onDelete:
            docSheetFor && docSheetFor.uploadedBy === myId
              ? () => deleteDoc.mutate(docSheetFor.id)
              : undefined,
        }}
      />

      {/* Documents folder — quick access to every attachment in the group */}
      <DocsFolderModal
        visible={folderOpen}
        docs={liveDocs}
        onOpen={(d) => openDoc(d)}
        onUpload={showAttachSheet}
        uploading={uploadDocs.isPending}
        onClose={() => setFolderOpen(false)}
      />

      {/* Full-screen photo viewer */}
      <Modal
        visible={!!viewerUri}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerUri(null)}>
          {viewerUri && (
            <Image
              source={{ uri: viewerUri }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          )}
          <Pressable
            onPress={() => setViewerUri(null)}
            hitSlop={10}
            style={[styles.viewerClose, { top: insets.top + Spacing.md }]}
          >
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Documents folder modal — standardised with the Trip docs modal ───────

type DocTab = 'ALL' | 'PHOTO' | 'DOCUMENT';

function DocsFolderModal({
  visible,
  docs,
  onOpen,
  onUpload,
  uploading,
  onClose,
}: {
  visible: boolean;
  docs: GroupDocumentFull[];
  onOpen: (d: GroupDocumentFull) => void;
  onUpload: () => void;
  uploading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<DocTab>('ALL');

  const photos = docs.filter((d) => d.fileType === 'PHOTO');
  const documents = docs.filter((d) => d.fileType === 'DOCUMENT');
  const filtered = tab === 'ALL' ? docs : tab === 'PHOTO' ? photos : documents;
  const counts = { ALL: docs.length, PHOTO: photos.length, DOCUMENT: documents.length };

  return (
    <Modal
      visible={visible}
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
          <Pressable onPress={onClose} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="close" size={24} color={c.foreground} />
          </Pressable>
          <Text style={[styles.docsTitle, { color: c.foreground }]}>{t('chat.groupDocsTitle')}</Text>
          <Pressable
            onPress={onUpload}
            disabled={uploading}
            hitSlop={8}
            style={({ pressed }) => [
              styles.uploadBtn,
              { backgroundColor: c.primary, opacity: pressed || uploading ? 0.85 : 1 },
            ]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
            )}
            <Text style={styles.uploadText}>{t('common.upload')}</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={[styles.docsTabs, { borderBottomColor: c.border }]}>
          {(['ALL', 'PHOTO', 'DOCUMENT'] as DocTab[]).map((tabKey) => {
            const active = tabKey === tab;
            const label =
              tabKey === 'ALL'
                ? t('documents.tabs.all')
                : tabKey === 'PHOTO'
                  ? t('documents.tabs.photos')
                  : t('documents.tabs.documents');
            return (
              <Pressable
                key={tabKey}
                onPress={() => setTab(tabKey)}
                style={[
                  styles.docsTab,
                  active && { borderBottomColor: c.primary, borderBottomWidth: 2 },
                ]}
              >
                <Text
                  style={[
                    styles.docsTabText,
                    {
                      color: active ? c.primary : c.mutedForeground,
                      fontWeight: active ? '700' : '500',
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
            <Text style={{ color: c.mutedForeground }}>{t('documents.nothingHere')}</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(d) => d.id}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onOpen(item)}
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
                {item.fileType === 'PHOTO' ? (
                  <Image source={{ uri: item.signedUrl }} style={styles.docRowThumb} />
                ) : (
                  <View
                    style={[
                      styles.docRowThumb,
                      { backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' },
                    ]}
                  >
                    <Ionicons name="document-text-outline" size={24} color={c.mutedForeground} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.docRowName, { color: c.foreground }]} numberOfLines={2}>
                    {item.fileName}
                  </Text>
                  <Text style={[styles.docRowMeta, { color: c.mutedForeground }]}>
                    {formatDate(item.createdAt)}
                    {fullName(item.uploader) ? ` · ${fullName(item.uploader)}` : ''}
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildActions(opts: {
  msg: GroupMessage | null;
  isOwn: boolean;
  onReply: (m: GroupMessage) => void;
  onCopy: (m: GroupMessage) => void;
  onEdit: (m: GroupMessage) => void;
  onDelete: (m: GroupMessage) => void;
}): MessageActions {
  const m = opts.msg;
  if (!m) return { onCopy: () => {} };
  const isDeleted = !!m.deletedAt;
  const canEdit =
    opts.isOwn &&
    !isDeleted &&
    Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
  return {
    onCopy: () => opts.onCopy(m),
    onReply: isDeleted ? undefined : () => opts.onReply(m),
    onEdit: canEdit ? () => opts.onEdit(m) : undefined,
    onDelete: opts.isOwn && !isDeleted ? () => opts.onDelete(m) : undefined,
  };
}

// ─── Banner (reply / edit preview above composer) ─────────────────────────

function Banner({
  kind,
  target,
  onCancel,
}: {
  kind: 'reply' | 'edit';
  target: ReplyTarget;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.banner, { backgroundColor: c.card, borderTopColor: c.border }]}>
      <View
        style={[
          styles.bannerQuote,
          { borderLeftColor: c.primary, backgroundColor: `${c.primary}14` },
        ]}
      >
        <View style={styles.bannerTitleRow}>
          <Ionicons
            name={kind === 'edit' ? 'create-outline' : 'arrow-undo-outline'}
            size={12}
            color={c.primary}
          />
          <Text style={[styles.bannerTitle, { color: c.primary }]}>
            {kind === 'edit'
              ? t('chat.editingMessage')
              : t('chat.replyTo', {
                  name: target.senderName ?? t('chat.unknownSender'),
                })}
          </Text>
        </View>
        <Text style={[styles.bannerPreview, { color: c.mutedForeground }]} numberOfLines={1}>
          {target.isDeleted
            ? target.targetType === 'doc'
              ? t('common.fileDeleted')
              : t('common.messageDeleted')
            : target.content}
        </Text>
      </View>
      <Pressable onPress={onCancel} hitSlop={6} style={styles.bannerClose}>
        <Ionicons name="close" size={18} color={c.mutedForeground} />
      </Pressable>
    </View>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────

const GroupBubble = memo(function GroupBubble({
  msg,
  isOwn,
  myId,
  highlighted,
  onLongPress,
  onReplyJump,
  onOpenUser,
}: {
  msg: GroupMessage;
  isOwn: boolean;
  myId: string;
  highlighted?: boolean;
  onLongPress: (m: GroupMessage) => void;
  onReplyJump: (targetId: string) => void;
  onOpenUser: (userId: string) => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDeleted = !!msg.deletedAt;
  const time = formatTime(msg.createdAt, { hour: '2-digit', minute: '2-digit' });
  const sidekick = isDeleted || msg.isSystem ? null : (
    <MessageReactionsCluster
      type="GROUP"
      targetId={msg.id}
      reactions={msg.reactions ?? []}
      currentUserId={myId}
    />
  );

  // System notices ("added X") render as centred, muted text — no bubble.
  if (msg.isSystem) {
    return (
      <View style={styles.systemRow}>
        <Text style={[styles.systemText, { color: c.mutedForeground }]}>
          {msg.content}
        </Text>
      </View>
    );
  }

  const senderName = fullName(msg.sender) || msg.sender?.role || t('nav.driverFallback');

  return (
    <View style={[styles.outerCol, isOwn && styles.outerColOwn]}>
      {/* Sender name above other people's messages so the group is readable.
          Tap it to peek at the sender's mini profile. */}
      {!isOwn && !isDeleted && (
        <Pressable onPress={() => msg.sender?.id && onOpenUser(msg.sender.id)} hitSlop={4}>
          <Text style={[styles.senderName, { color: c.primary }]} numberOfLines={1}>
            {senderName}
          </Text>
        </Pressable>
      )}
      <View style={styles.reactRow}>
      {isOwn && sidekick}
      <Pressable
        onLongPress={() => onLongPress(msg)}
        delayLongPress={400}
        style={[
          styles.bubble,
          isDeleted
            ? styles.bubbleDeleted
            : isOwn
            ? { backgroundColor: c.primary }
            : { backgroundColor: c.muted },
          highlighted && { borderWidth: 2, borderColor: c.primary },
        ]}
      >
        {!isDeleted && msg.replyTo && (
          <MessageQuote
            senderName={fullName(msg.replyTo.sender)}
            content={msg.replyTo.content}
            isDeleted={!!msg.replyTo.deletedAt}
            onPress={() => onReplyJump(msg.replyTo!.id)}
            variant={isOwn ? 'onPrimary' : 'default'}
          />
        )}
        {!isDeleted && msg.replyToDocument && (
          <MessageQuote
            kind="doc"
            senderName={fullName(msg.replyToDocument.uploader)}
            fileName={msg.replyToDocument.fileName}
            content=""
            isDeleted={!!msg.replyToDocument.deletedAt}
            onPress={() => onReplyJump(msg.replyToDocument!.id)}
            variant={isOwn ? 'onPrimary' : 'default'}
          />
        )}
        <Text
          style={[
            styles.bubbleText,
            {
              color: isDeleted
                ? c.mutedForeground
                : isOwn
                ? c.primaryForeground
                : c.foreground,
              fontStyle: isDeleted ? 'italic' : 'normal',
              fontSize: isDeleted ? 12 : 14,
            },
          ]}
        >
          {isDeleted ? t('common.messageDeleted') : msg.content}
        </Text>
      </Pressable>
      {!isOwn && sidekick}
      </View>
      <View style={[styles.meta, isOwn && styles.metaOwn]}>
        {msg.editedAt && !isDeleted && (
          <Text
            style={[styles.metaText, { color: c.mutedForeground, fontStyle: 'italic' }]}
          >
            {t('chat.editedShort')}
          </Text>
        )}
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>{time}</Text>
      </View>
    </View>
  );
});

// ─── Document bubble (photo thumbnail / file card) ────────────────────────

const DocBubble = memo(function DocBubble({
  doc,
  isOwn,
  myId,
  highlighted,
  onOpen,
  onLongPress,
}: {
  doc: GroupDocumentFull;
  isOwn: boolean;
  myId: string;
  highlighted?: boolean;
  onOpen: (d: GroupDocumentFull) => void;
  onLongPress: (d: GroupDocumentFull) => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDeleted = !!doc.deletedAt;
  const isPhoto = doc.fileType === 'PHOTO';
  const time = formatTime(doc.createdAt, { hour: '2-digit', minute: '2-digit' });
  const senderName = fullName(doc.uploader) || doc.uploader?.role || t('nav.driverFallback');
  const sidekick = isDeleted ? null : (
    <MessageReactionsCluster
      type="GROUP_DOC"
      targetId={doc.id}
      reactions={doc.reactions ?? []}
      currentUserId={myId}
    />
  );

  if (isDeleted) {
    return (
      <View style={[styles.outerCol, isOwn && styles.outerColOwn]}>
        <View style={[styles.bubble, styles.bubbleDeleted]}>
          <Text style={[styles.bubbleText, { color: c.mutedForeground, fontStyle: 'italic', fontSize: 12 }]}>
            {t('common.fileDeleted')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.outerCol, isOwn && styles.outerColOwn]}>
      {!isOwn && (
        <Text style={[styles.senderName, { color: c.primary }]} numberOfLines={1}>
          {senderName}
        </Text>
      )}
      <View style={[styles.reactRow, styles.reactRowDoc]}>
      {isOwn && sidekick}
      <Pressable
        onPress={() => onOpen(doc)}
        onLongPress={() => onLongPress(doc)}
        delayLongPress={400}
        style={[
          styles.docBubble,
          { backgroundColor: isOwn ? c.primary : c.muted },
          highlighted && { borderWidth: 2, borderColor: c.primary },
        ]}
      >
        {isPhoto ? (
          <Image source={{ uri: doc.signedUrl }} style={styles.docThumb} />
        ) : (
          <View style={styles.docFileRow}>
            <Ionicons
              name="document-text"
              size={22}
              color={isOwn ? c.primaryForeground : c.foreground}
            />
            <Text
              style={[
                styles.docFileName,
                { color: isOwn ? c.primaryForeground : c.foreground },
              ]}
              numberOfLines={2}
            >
              {doc.fileName}
            </Text>
          </View>
        )}
        {doc.caption ? (
          <Text
            style={[
              styles.docCaption,
              { color: isOwn ? c.primaryForeground : c.foreground },
            ]}
          >
            {doc.caption}
          </Text>
        ) : null}
      </Pressable>
      {!isOwn && sidekick}
      </View>
      <View style={[styles.meta, isOwn && styles.metaOwn]}>
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>{time}</Text>
      </View>
    </View>
  );
});

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  backBtn: { padding: 4 },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerName: { fontSize: 15, fontWeight: '600' },
  headerRole: { fontSize: 12, marginTop: 1 },
  folderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  folderBtnText: { fontSize: 12, fontWeight: '600' },

  // Photo viewer
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: { position: 'absolute', right: Spacing.lg },

  // Documents folder (standardised with the Trip docs modal)
  docsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  docsTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },
  uploadText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  docsTabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  docsTab: { flex: 1, paddingVertical: Spacing.md, alignItems: 'center' },
  docsTabText: { fontSize: 13 },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  docRowThumb: { width: 56, height: 56, borderRadius: Radius.sm },
  docRowName: { fontSize: 13, fontWeight: '600' },
  docRowMeta: { fontSize: 10, marginTop: 2 },

  // System notice
  systemRow: { alignItems: 'center', paddingVertical: 4, paddingHorizontal: Spacing.lg },
  systemText: { fontSize: 11, textAlign: 'center' },

  outerCol: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
    maxWidth: '92%',
    alignSelf: 'flex-start',
  },
  outerColOwn: { alignSelf: 'flex-end' },
  reactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Attachments vary in height; pin the reaction to the bottom edge so the gap
  // reads the same for tall photos and short file cards.
  reactRowDoc: { alignItems: 'flex-end' },
  senderName: { fontSize: 11, fontWeight: '700', marginBottom: 2, marginLeft: 4 },

  bubble: {
    borderRadius: Radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: '100%',
  },
  bubbleDeleted: {
    backgroundColor: 'rgba(128,128,128,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  bubbleText: { lineHeight: 18 },

  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  metaOwn: { flexDirection: 'row-reverse' },
  metaText: { fontSize: 10 },

  // Banner (reply / edit)
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  bannerQuote: {
    flex: 1,
    borderLeftWidth: 2,
    paddingLeft: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  bannerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bannerTitle: { fontSize: 11, fontWeight: '600' },
  bannerPreview: { fontSize: 11, marginTop: 1 },
  bannerClose: { padding: 4 },

  // Document bubble
  docBubble: {
    borderRadius: Radius.lg,
    padding: 4,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  docThumb: {
    width: 200,
    height: 200,
    borderRadius: Radius.md,
  },
  docFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 8,
    maxWidth: 240,
  },
  docFileName: { flex: 1, fontSize: 13, fontWeight: '600' },
  docCaption: { fontSize: 13, paddingHorizontal: 6, paddingVertical: 4 },

  // Composer
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  attachBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
