import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fullName, initials } from "@/lib/format";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MessageActionsSheet, type MessageActions } from '@/components/message-actions-sheet';
import { MessageQuote } from '@/components/message-quote';
import { MessageReactionsCluster } from '@/components/message-reactions';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChatEvents } from '@/hooks/use-chat-events';
import {
  useConversationDocuments,
  useConversationDocsSocketSync,
  useDeleteConversationDoc,
  useUploadConversationDocs,
  type ConversationDocumentFull,
} from '@/hooks/use-conversation-documents';
import {
  useChatUser,
  useDeleteDirectMessage,
  useDirectMessages,
  useEditDirectMessage,
  type DirectMessage,
} from '@/hooks/use-direct-messages';
import { useReactionsSocketSync } from '@/hooks/use-message-reactions';
import { formatDate, formatTime } from '@/lib/format-date';
import { getSocket } from '@/lib/socket';
import { useUser } from '@/store/auth';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

type ReplyTarget = {
  id: string;
  targetType: 'msg' | 'doc';
  senderName: string | null;
  content: string;
  isDeleted: boolean;
};

type EditingState = { id: string; original: string };

// Messages + documents share one time-ordered timeline.
type TimelineItem =
  | { kind: 'msg'; data: DirectMessage; ts: number }
  | { kind: 'doc'; data: ConversationDocumentFull; ts: number };

export default function DmScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { userId: peerId } = useLocalSearchParams<{ userId: string }>();
  const me = useUser();
  const myId = me?.id ?? '';

  // These screens are pushed from the Chat tab but live as drawer routes, so
  // a plain back pops to the drawer's initial screen (Trips). Step back to
  // the Chat list explicitly — for both the header chevron and Android's
  // hardware back button.
  const goBackToChat = () => router.navigate('/(driver)/chat');
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.navigate('/(driver)/chat');
      return true;
    });
    return () => sub.remove();
  }, []);

  // Drawer keeps screens mounted, so this DM screen stays alive after you
  // navigate away. Only mark messages read while it's actually focused —
  // otherwise incoming messages get silently ack'd and never show as unread.
  const isFocused = useIsFocused();
  const focusedRef = useRef(isFocused);
  useEffect(() => {
    focusedRef.current = isFocused;
  }, [isFocused]);

  // ─── Data ──────────────────────────────────────────────────────────
  const { data: peer } = useChatUser(peerId);
  const { data: messages = [], isLoading } = useDirectMessages(peerId);
  const { data: documents = [] } = useConversationDocuments(peerId);
  const deleteMsg = useDeleteDirectMessage();
  const editMsg = useEditDirectMessage(peerId);
  const uploadDocs = useUploadConversationDocs(peerId);
  const deleteDoc = useDeleteConversationDoc(peerId);

  // ─── Realtime ──────────────────────────────────────────────────────
  useChatEvents({ dmOtherUserId: peerId, myUserId: myId });
  useReactionsSocketSync({ dmOtherUserId: peerId });
  useConversationDocsSocketSync(peerId);

  // Mark-as-read fires only on conversation open (peer change). Subsequent
  // unread bumps from inbound messages are caught by the socket handler
  // below so we don't double-emit on every messages.length change (which
  // would echo the same event twice per render).
  useEffect(() => {
    if (peerId && isFocused) getSocket().emit('mark_as_read', { senderId: peerId });
  }, [peerId, isFocused]);

  // While the conversation is open, ACK each incoming message from the
  // peer immediately so their ✓✓ flips without waiting for the next open.
  useEffect(() => {
    if (!peerId) return;
    const socket = getSocket();
    const onNewDirect = (m: DirectMessage) => {
      if (focusedRef.current && m.senderId === peerId && m.receiverId === myId) {
        socket.emit('mark_as_read', { senderId: peerId });
      }
    };
    socket.on('new_direct_message', onNewDirect);
    return () => {
      socket.off('new_direct_message', onNewDirect);
    };
  }, [peerId, myId]);

  // ─── Composer state ────────────────────────────────────────────────
  const [text, setText] = useState('');
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);

  // Photo viewer + documents folder overlays.
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);

  // ─── Long-press actions sheet ──────────────────────────────────────
  const [sheetFor, setSheetFor] = useState<DirectMessage | null>(null);
  const [docSheetFor, setDocSheetFor] = useState<ConversationDocumentFull | null>(null);

  // Live (non-deleted) docs power the folder count + the folder modal.
  const liveDocs = useMemo(() => documents.filter((d) => !d.deletedAt), [documents]);

  // ─── List — messages + documents merged into one timeline ──────────
  const listRef = useRef<FlatList<TimelineItem>>(null);
  // Newest first for the inverted list (viewport is flipped, so the newest
  // item sits at the visual bottom).
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
    return items.sort((a, b) => b.ts - a.ts);
  }, [messages, documents]);

  // ─── Jump to a replied-to message/document ─────────────────────────
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollToMessage = (targetId?: string | null) => {
    if (!targetId) return;
    const index = data.findIndex((it) => it.data.id === targetId);
    if (index < 0) return; // original is older than the loaded page
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setHighlightId(targetId);
    setTimeout(
      () => setHighlightId((h) => (h === targetId ? null : h)),
      1500,
    );
  };

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

  const openDoc = async (doc: ConversationDocumentFull) => {
    if (doc.fileType === 'PHOTO') {
      setViewerUri(doc.signedUrl);
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(doc.signedUrl);
    } catch (e) {
      Alert.alert(t('documents.cannotOpen'), (e as Error).message);
    }
  };

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
    getSocket().emit('send_direct_message', {
      receiverId: peerId,
      content: trimmed,
      replyToId: replyMsgId,
      replyToDocumentId: replyDocId,
    });
    setText('');
    setReplyingTo(null);
  };

  // ─── Header ────────────────────────────────────────────────────────
  const peerName = fullName(peer) || t('nav.chatFallback');
  const peerInitials = initials(peer);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
        <Pressable
          onPress={goBackToChat}
          hitSlop={10}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={26} color={c.foreground} />
        </Pressable>
        <View style={[styles.headerAvatar, { backgroundColor: c.muted }]}>
          <Text style={[styles.headerAvatarText, { color: c.primary }]}>
            {peerInitials}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.headerName, { color: c.foreground }]} numberOfLines={1}>
            {peerName}
          </Text>
          <Text style={[styles.headerRole, { color: c.mutedForeground }]} numberOfLines={1}>
            {peer?.role?.toLowerCase()}
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
          inverted
          contentContainerStyle={{ paddingVertical: Spacing.sm }}
          onScrollToIndexFailed={() => {}}
          renderItem={({ item }) =>
            item.kind === 'msg' ? (
              <MessageBubble
                msg={item.data}
                isOwn={item.data.senderId === myId}
                myId={myId}
                highlighted={item.data.id === highlightId}
                onLongPress={() => setSheetFor(item.data)}
                onReplyJump={scrollToMessage}
              />
            ) : (
              <DocBubble
                doc={item.data}
                isOwn={item.data.uploadedBy === myId}
                highlighted={item.data.id === highlightId}
                onOpen={() => openDoc(item.data)}
                onLongPress={() => setDocSheetFor(item.data)}
              />
            )
          }
        />
      )}

      {/* Reply banner */}
      {replyingTo && !editing && (
        <Banner
          kind="reply"
          target={replyingTo}
          onCancel={() => setReplyingTo(null)}
        />
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

      {/* Documents folder — quick access to every attachment in the chat */}
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function buildActions(opts: {
  msg: DirectMessage | null;
  isOwn: boolean;
  onReply: (m: DirectMessage) => void;
  onCopy: (m: DirectMessage) => void;
  onEdit: (m: DirectMessage) => void;
  onDelete: (m: DirectMessage) => void;
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
    <View
      style={[
        styles.banner,
        { backgroundColor: c.card, borderTopColor: c.border },
      ]}
    >
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
        <Text
          style={[styles.bannerPreview, { color: c.mutedForeground }]}
          numberOfLines={1}
        >
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

function MessageBubble({
  msg,
  isOwn,
  myId,
  highlighted,
  onLongPress,
  onReplyJump,
}: {
  msg: DirectMessage;
  isOwn: boolean;
  myId: string;
  highlighted?: boolean;
  onLongPress: () => void;
  onReplyJump: (targetId: string) => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDeleted = !!msg.deletedAt;
  const time = formatTime(msg.createdAt, { hour: '2-digit', minute: '2-digit' });

  // Cluster sits inline with the bubble (own→left, other→right). It always
  // renders my Trigger (active emoji or idle 👍 outline) and appends the
  // other participant's reactions as plain glyphs next to it.
  const sidekick = isDeleted ? null : (
    <MessageReactionsCluster
      type="DM"
      targetId={msg.id}
      reactions={msg.reactions ?? []}
      currentUserId={myId}
    />
  );

  const bubble = (
    <Pressable
      onLongPress={onLongPress}
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
  );

  return (
    <View style={[styles.outerCol, isOwn && styles.outerColOwn]}>
      {/* trigger + bubble inline so `alignItems:center` centres trigger
          on the bubble only (not on bubble + meta + bar) */}
      <View style={styles.bubbleRow}>
        {isOwn && sidekick}
        {bubble}
        {!isOwn && sidekick}
      </View>
      <View style={[styles.meta, isOwn && styles.metaOwn]}>
        {msg.editedAt && !isDeleted && (
          <Text
            style={[
              styles.metaText,
              { color: c.mutedForeground, fontStyle: 'italic' },
            ]}
          >
            {t('chat.editedShort')}
          </Text>
        )}
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>
          {time}
        </Text>
        {isOwn && (
          <Text
            style={[
              styles.metaText,
              { color: msg.isRead ? c.primary : c.mutedForeground },
            ]}
          >
            {msg.isRead ? '✓✓' : '✓'}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Document bubble (photo thumbnail / file card) ────────────────────────

function DocBubble({
  doc,
  isOwn,
  highlighted,
  onOpen,
  onLongPress,
}: {
  doc: ConversationDocumentFull;
  isOwn: boolean;
  highlighted?: boolean;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDeleted = !!doc.deletedAt;
  const isPhoto = doc.fileType === 'PHOTO';
  const time = formatTime(doc.createdAt, { hour: '2-digit', minute: '2-digit' });

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
      <Pressable
        onPress={onOpen}
        onLongPress={onLongPress}
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
              style={[styles.docFileName, { color: isOwn ? c.primaryForeground : c.foreground }]}
              numberOfLines={2}
            >
              {doc.fileName}
            </Text>
          </View>
        )}
        {doc.caption ? (
          <Text style={[styles.docCaption, { color: isOwn ? c.primaryForeground : c.foreground }]}>
            {doc.caption}
          </Text>
        ) : null}
      </Pressable>
      <View style={[styles.meta, isOwn && styles.metaOwn]}>
        <Text style={[styles.metaText, { color: c.mutedForeground }]}>{time}</Text>
      </View>
    </View>
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
  docs: ConversationDocumentFull[];
  onOpen: (d: ConversationDocumentFull) => void;
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
          <Text style={[styles.docsTitle, { color: c.foreground }]}>{t('nav.items.documents')}</Text>
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
  headerAvatarText: { fontWeight: '700', fontSize: 13 },
  headerText: { flex: 1, minWidth: 0 },
  headerName: { fontSize: 15, fontWeight: '600' },
  headerRole: { fontSize: 12, marginTop: 1, textTransform: 'capitalize' },
  folderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  folderBtnText: { fontSize: 12, fontWeight: '600' },

  // Document bubble
  docBubble: {
    borderRadius: Radius.lg,
    padding: 4,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  docThumb: { width: 200, height: 200, borderRadius: Radius.md },
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
  attachBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Outer column owns the bubble + meta + bar so they share the same
  // horizontal edge (own→right, other→left). The reaction trigger sits
  // inside `bubbleRow` so it's only centred relative to the bubble itself
  // — not the whole column (which would push the trigger off-centre).
  outerCol: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 3,
    maxWidth: '92%',
    alignSelf: 'flex-start',
  },
  outerColOwn: { alignSelf: 'flex-end' },
  bubbleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  barWrap: { marginTop: 3 },
  barWrapOwn: { alignItems: 'flex-end' },

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

  // Composer
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
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
