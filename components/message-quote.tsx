import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
  senderName: string | null;
  /** Original text content. Ignored when `kind === 'doc'`. */
  content: string;
  isDeleted?: boolean;
  /** What kind of target this quote points at. */
  kind?: 'msg' | 'doc';
  /** File name (only when `kind === 'doc'`). */
  fileName?: string;
  /** Tap handler — usually scrolls to the original message/doc. */
  onPress?: () => void;
  /** Tweaks colours for use inside the user's own (primary) bubble. */
  variant?: 'default' | 'onPrimary';
}

/**
 * Telegram/Viber-style reply quote shown above a message's content.
 *
 * Renders a vertical accent line on the left, the original sender's name,
 * and a one-line preview of the original message. Document quotes show a
 * 📎 icon + file name instead of text.
 */
export function MessageQuote({
  senderName,
  content,
  isDeleted = false,
  kind = 'msg',
  fileName,
  onPress,
  variant = 'default',
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDoc = kind === 'doc';
  const tombstone = isDoc ? 'Файл видалено' : 'Повідомлення видалено';

  const accent = variant === 'onPrimary' ? c.primaryForeground : c.primary;
  const muted =
    variant === 'onPrimary' ? `${c.primaryForeground}B3` : c.mutedForeground;
  const bg =
    variant === 'onPrimary'
      ? `${c.primaryForeground}1A`
      : `${c.primary}1A`;

  const previewText = isDeleted
    ? tombstone
    : isDoc
    ? fileName ?? 'Файл'
    : content;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.root,
        {
          borderLeftColor: accent,
          backgroundColor: bg,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.sender, { color: accent }]} numberOfLines={1}>
        {senderName ?? 'Unknown'}
      </Text>
      <View style={styles.previewRow}>
        {isDoc && !isDeleted && (
          <Ionicons
            name="attach-outline"
            size={11}
            color={muted}
            style={styles.attachIcon}
          />
        )}
        <Text
          style={[
            styles.preview,
            { color: muted, fontStyle: isDeleted ? 'italic' : 'normal' },
          ]}
          numberOfLines={1}
        >
          {previewText}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    borderLeftWidth: 2,
    borderRadius: Radius.sm,
    paddingLeft: Spacing.sm,
    paddingVertical: 4,
    marginBottom: 4,
  },
  sender: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachIcon: {
    marginRight: 3,
  },
  preview: {
    fontSize: 11,
    lineHeight: 14,
    flex: 1,
  },
});
