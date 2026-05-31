import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
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
  useChatUser,
  useDeleteDirectMessage,
  useDirectMessages,
  useEditDirectMessage,
  type DirectMessage,
} from '@/hooks/use-direct-messages';
import { useReactionsSocketSync } from '@/hooks/use-message-reactions';
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

export default function DmScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { userId: peerId } = useLocalSearchParams<{ userId: string }>();
  const me = useUser();
  const myId = me?.id ?? '';

  // ─── Data ──────────────────────────────────────────────────────────
  const { data: peer } = useChatUser(peerId);
  const { data: messages = [], isLoading } = useDirectMessages(peerId);
  const deleteMsg = useDeleteDirectMessage();
  const editMsg = useEditDirectMessage(peerId);

  // ─── Realtime ──────────────────────────────────────────────────────
  useChatEvents({ dmOtherUserId: peerId, myUserId: myId });
  useReactionsSocketSync({ dmOtherUserId: peerId });

  // Mark-as-read fires only on conversation open (peer change). Subsequent
  // unread bumps from inbound messages are caught by the socket handler
  // below so we don't double-emit on every messages.length change (which
  // would echo the same event twice per render).
  useEffect(() => {
    if (peerId) getSocket().emit('mark_as_read', { senderId: peerId });
  }, [peerId]);

  // While the conversation is open, ACK each incoming message from the
  // peer immediately so their ✓✓ flips without waiting for the next open.
  useEffect(() => {
    if (!peerId) return;
    const socket = getSocket();
    const onNewDirect = (m: DirectMessage) => {
      if (m.senderId === peerId && m.receiverId === myId) {
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

  // ─── Long-press actions sheet ──────────────────────────────────────
  const [sheetFor, setSheetFor] = useState<DirectMessage | null>(null);

  // ─── List ──────────────────────────────────────────────────────────
  const listRef = useRef<FlatList<DirectMessage>>(null);
  // Reverse-sort by time so the newest message sits at the visual bottom
  // when we render with `inverted` (FlatList renders top-to-bottom but the
  // viewport is flipped — easier scroll-to-bottom semantics).
  const data = useMemo(() => [...messages].reverse(), [messages]);

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
  const peerName = peer?.name ?? 'Chat';
  const peerInitials = (peer?.name ?? '??').slice(0, 2).toUpperCase();

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
          onPress={() => router.back()}
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
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={{ paddingVertical: Spacing.sm }}
          renderItem={({ item }) => (
            <MessageBubble
              msg={item}
              isOwn={item.senderId === myId}
              myId={myId}
              onLongPress={() => setSheetFor(item)}
              onReplyJump={() => {
                // TODO: scroll to message id — for now no-op; the original
                // is somewhere above and the user can scroll manually.
              }}
            />
          )}
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
            senderName: me?.name ?? null,
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
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={editing ? 'Редагуйте повідомлення…' : 'Type a message…'}
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
              senderName: m.sender?.name ?? null,
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
              ? 'Редагування повідомлення'
              : `Reply to ${target.senderName ?? 'Unknown'}`}
          </Text>
        </View>
        <Text
          style={[styles.bannerPreview, { color: c.mutedForeground }]}
          numberOfLines={1}
        >
          {target.isDeleted
            ? target.targetType === 'doc'
              ? 'Файл видалено'
              : 'Повідомлення видалено'
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
  onLongPress,
  onReplyJump,
}: {
  msg: DirectMessage;
  isOwn: boolean;
  myId: string;
  onLongPress: () => void;
  onReplyJump: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDeleted = !!msg.deletedAt;
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

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
      ]}
    >
      {!isDeleted && msg.replyTo && (
        <MessageQuote
          senderName={msg.replyTo.sender.name}
          content={msg.replyTo.content}
          isDeleted={!!msg.replyTo.deletedAt}
          onPress={onReplyJump}
          variant={isOwn ? 'onPrimary' : 'default'}
        />
      )}
      {!isDeleted && msg.replyToDocument && (
        <MessageQuote
          kind="doc"
          senderName={msg.replyToDocument.uploader.name}
          fileName={msg.replyToDocument.fileName}
          content=""
          isDeleted={!!msg.replyToDocument.deletedAt}
          onPress={onReplyJump}
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
        {isDeleted ? 'Повідомлення видалено' : msg.content}
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
            (ред.)
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

  barWrap: { marginTop: 2 },
  barWrapOwn: { alignItems: 'flex-end' },

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
