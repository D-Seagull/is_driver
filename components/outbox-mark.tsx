import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { discardOutboxItem, retryOutboxItem } from '@/lib/outbox';

/** Id prefix of an outbox item shown in a chat list as a message. */
export const PENDING_PREFIX = 'pending:';

/**
 * Delivery state of an own message that is still in the offline outbox:
 * a clock while it waits for a connection, a red "!" when the server refused
 * it (tap → retry / delete). Renders nothing for a delivered message.
 */
export function OutboxMark({
  msg,
}: {
  msg: { id: string; pending?: boolean; failed?: boolean };
}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  if (!msg.pending && !msg.failed) return null;
  const clientId = msg.id.startsWith(PENDING_PREFIX) ? msg.id.slice(PENDING_PREFIX.length) : msg.id;

  if (msg.failed) {
    return (
      <Pressable
        hitSlop={10}
        onPress={() =>
          Alert.alert(t('chat.outboxFailedTitle', 'Не вдалося надіслати'), undefined, [
            { text: t('chat.outboxRetry', 'Повторити'), onPress: () => retryOutboxItem(clientId) },
            {
              text: t('chat.outboxDiscard', 'Видалити'),
              style: 'destructive',
              onPress: () => discardOutboxItem(clientId),
            },
            { text: t('common.cancel', 'Скасувати'), style: 'cancel' },
          ])
        }
      >
        <Ionicons name="alert-circle" size={13} color={c.destructive} />
      </Pressable>
    );
  }
  return <Ionicons name="time-outline" size={12} color={c.mutedForeground} />;
}
