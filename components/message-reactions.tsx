import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useToggleReaction } from '@/hooks/use-message-reactions';
import type {
  MessageReactionRow,
  ReactionTarget,
} from '@/hooks/use-message-reactions';

const PICKER_EMOJIS = ['👍', '😮', '😢'] as const;

// ─── Reactions cluster (sidekick next to the bubble) ─────────────────────

interface ClusterProps {
  type: ReactionTarget;
  targetId: string;
  reactions: MessageReactionRow[];
  currentUserId?: string;
}

/**
 * Inline cluster shown next to a chat bubble. Always renders the user's
 * Trigger (their own reaction or an idle 👍 outline) and — if anyone else
 * reacted — their emojis as plain glyphs alongside it, without any chip
 * background. Counts appear only when an emoji has more than one user.
 */
export function MessageReactionsCluster({
  type,
  targetId,
  reactions,
  currentUserId,
}: ClusterProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const toggle = useToggleReaction();

  // Group others' reactions (everyone except me) by emoji.
  const others = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reactions) {
      if (r.userId === currentUserId) continue;
      map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1);
    }
    return [...map.entries()].map(([emoji, count]) => ({ emoji, count }));
  }, [reactions, currentUserId]);

  return (
    <View style={styles.clusterRow}>
      <MessageReactionsTrigger
        type={type}
        targetId={targetId}
        reactions={reactions}
        currentUserId={currentUserId}
      />
      {others.map((o) => (
        <Pressable
          key={o.emoji}
          onPress={() => toggle.mutate({ type, id: targetId, emoji: o.emoji })}
          hitSlop={6}
          style={({ pressed }) => [
            styles.othersChip,
            { opacity: pressed ? 0.5 : 1 },
          ]}
        >
          <Text style={styles.othersEmoji}>{o.emoji}</Text>
          {o.count > 1 && (
            <Text style={[styles.othersCount, { color: c.mutedForeground }]}>
              {o.count}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

// ─── Reactions bar (under the bubble) ─────────────────────────────────────

interface BarProps {
  reactions: MessageReactionRow[];
  isOwn: boolean;
  currentUserId?: string;
  /** Hide entirely when the user already reacted (matches web group chat). */
  hideWhenReacted?: boolean;
  type: ReactionTarget;
  targetId: string;
}

/**
 * Shown below a chat bubble — one chip per distinct emoji with a count of
 * how many people reacted with it. Tapping a chip toggles your own reaction.
 */
export function MessageReactionsBar({
  reactions,
  isOwn,
  currentUserId,
  hideWhenReacted = false,
  type,
  targetId,
}: BarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const toggle = useToggleReaction();

  // Group by emoji → [{ emoji, count, mine }]. Memo must come before any
  // early return so the hook order is stable between renders.
  const grouped = useMemo(() => {
    const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of reactions) {
      const entry = map.get(r.emoji);
      const mine = r.userId === currentUserId;
      if (entry) {
        entry.count += 1;
        if (mine) entry.mine = true;
      } else {
        map.set(r.emoji, { emoji: r.emoji, count: 1, mine });
      }
    }
    return [...map.values()];
  }, [reactions, currentUserId]);

  const myReaction = currentUserId
    ? reactions.find((r) => r.userId === currentUserId)
    : undefined;

  if (hideWhenReacted && myReaction) return null;
  if (reactions.length === 0) return null;

  return (
    <View style={[styles.barRow, isOwn && styles.barRowOwn]}>
      {grouped.map((g) => (
        <Pressable
          key={g.emoji}
          onPress={() =>
            toggle.mutate({ type, id: targetId, emoji: g.emoji })
          }
          style={({ pressed }) => [
            styles.chip,
            {
              // Mine: subtle primary tint. Others: small grey wash so the
              // emoji is still readable without competing with the bubble.
              // No border on either case — keeps the row clean.
              backgroundColor: g.mine ? `${c.primary}26` : 'transparent',
              opacity: pressed ? 0.6 : g.mine ? 1 : 0.7,
            },
          ]}
        >
          <Text style={[styles.chipEmoji, !g.mine && { opacity: 0.85 }]}>
            {g.emoji}
          </Text>
          {g.count > 1 && (
            <Text
              style={[
                styles.chipCount,
                { color: g.mine ? c.primary : c.mutedForeground },
              ]}
            >
              {g.count}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

// ─── Reactions trigger (small "+" button next to bubble) ──────────────────

interface TriggerProps {
  type: ReactionTarget;
  targetId: string;
  reactions: MessageReactionRow[];
  currentUserId?: string;
}

/**
 * Tiny thumbs-up button next to the bubble.
 *
 * - **Tap** toggles 👍 (or removes whatever reaction the user previously
 *   left — the backend replaces one-per-target either way).
 * - **Long-press** opens the full picker (👍 / 😮 / 😢).
 * - When the user has NO reaction, the button is fully transparent /
 *   borderless so it doesn't compete visually with the bubble.
 */
export function MessageReactionsTrigger({
  type,
  targetId,
  reactions,
  currentUserId,
}: TriggerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [open, setOpen] = useState(false);
  const toggle = useToggleReaction();

  const myReaction = currentUserId
    ? reactions.find((r) => r.userId === currentUserId)
    : undefined;

  const tapToggle = () => {
    // Tapping always means "I want 👍". Backend treats a repeat of the
    // same emoji as a removal, so this naturally toggles thumbs-up on/off.
    toggle.mutate({ type, id: targetId, emoji: '👍' });
  };

  const pick = (emoji: string) => {
    setOpen(false);
    toggle.mutate({ type, id: targetId, emoji });
  };

  const displayEmoji = myReaction?.emoji ?? '👍';
  const hasReaction = !!myReaction;

  return (
    <>
      <Pressable
        onPress={tapToggle}
        onLongPress={() => setOpen(true)}
        delayLongPress={300}
        hitSlop={10}
        style={({ pressed }) => [
          styles.triggerBtn,
          {
            // Idle state stays small + faded so it reads as an invitation,
            // not a real reaction. Active state pops to full size + opacity.
            opacity: pressed ? 0.4 : hasReaction ? 1 : 0.4,
          },
        ]}
      >
        {hasReaction ? (
          // Active reaction: the user's chosen emoji rendered in full
          // colour. No background, no border — it stands on its own.
          <Text style={styles.triggerLabel}>{displayEmoji}</Text>
        ) : (
          // Idle: small, faded, monochrome thumbs-up outline.
          <Ionicons
            name="thumbs-up-outline"
            size={14}
            color={c.mutedForeground}
          />
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.pickerBackdrop}
          onPress={() => setOpen(false)}
        >
          <Pressable
            onPress={() => {}}
            style={[
              styles.pickerCard,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            {PICKER_EMOJIS.map((e) => (
              <Pressable
                key={e}
                onPress={() => pick(e)}
                style={({ pressed }) => [
                  styles.pickerItem,
                  {
                    opacity: pressed ? 0.6 : 1,
                    backgroundColor:
                      myReaction?.emoji === e ? `${c.primary}26` : 'transparent',
                  },
                ]}
              >
                <Text style={styles.pickerEmoji}>{e}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Bar
  barRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  barRowOwn: { justifyContent: 'flex-end' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    gap: 2,
  },
  chipEmoji: { fontSize: 13 },
  chipCount: { fontSize: 10, fontWeight: '600' },

  // Cluster (sidekick) — inline row hosting the Trigger + other reactions.
  clusterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  othersChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingVertical: 1,
    gap: 1,
  },
  othersEmoji: { fontSize: 14 },
  othersCount: { fontSize: 10, fontWeight: '600' },

  // Trigger — no background, no border. Just the icon/emoji.
  triggerBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerLabel: { fontSize: 18 },

  // Picker
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCard: {
    flexDirection: 'row',
    padding: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  pickerItem: {
    padding: 10,
    borderRadius: Radius.md,
  },
  pickerEmoji: { fontSize: 28 },
});
