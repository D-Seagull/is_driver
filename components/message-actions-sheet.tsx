import { Ionicons } from '@expo/vector-icons';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface MessageActions {
  /** Always available — copies plain text or filename to clipboard. */
  onCopy: () => void;
  /** Optional — caller sets the chat's "reply-to" state. */
  onReply?: () => void;
  /** Optional — caller toggles edit mode. Only own + not deleted + <15min. */
  onEdit?: () => void;
  /** Optional — soft-delete on the server. Only own + not yet deleted. */
  onDelete?: () => void;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  actions: MessageActions;
}

/**
 * Bottom-sheet style action menu for a chat bubble, opened by long-press.
 * Mirrors the web context menu (Reply / Copy / Edit / Delete) — entries
 * that the caller doesn't pass simply aren't rendered.
 */
export function MessageActionsSheet({ visible, onClose, actions }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  const handle = (cb?: () => void) => () => {
    onClose();
    // Defer to next tick so the modal-close animation has a chance to start
    // before the caller's mutation pops a new modal (edit form, etc.).
    if (cb) setTimeout(cb, 0);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          // Stop propagation so taps inside the sheet don't close it.
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              paddingBottom: Math.max(insets.bottom, Spacing.md),
            },
          ]}
        >
          {actions.onReply && (
            <ActionRow
              icon="arrow-undo-outline"
              label="Reply"
              color={c.foreground}
              onPress={handle(actions.onReply)}
            />
          )}
          <ActionRow
            icon="copy-outline"
            label="Copy"
            color={c.foreground}
            onPress={handle(actions.onCopy)}
          />
          {actions.onEdit && (
            <ActionRow
              icon="create-outline"
              label="Edit"
              color={c.foreground}
              onPress={handle(actions.onEdit)}
            />
          )}
          {actions.onDelete && (
            <>
              <View
                style={[
                  styles.separator,
                  { backgroundColor: c.border },
                ]}
              />
              <ActionRow
                icon="trash-outline"
                label="Delete"
                color="#ef4444"
                onPress={handle(actions.onDelete)}
              />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionRow({
  icon,
  label,
  color,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingTop: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
  },
  rowIcon: { width: 24 },
  rowLabel: {
    fontSize: 16,
    marginLeft: Spacing.md,
    fontWeight: '500',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
});
