import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { useLastSeen } from '@/hooks/use-presence';
import { formatDate, formatTime } from '@/lib/format-date';

// Below this, someone who just closed the app isn't worth a timestamp.
const SHOW_AFTER_MS = 15 * 60 * 1000;

/** Re-renders every minute so "15 min out of the app" is crossed live. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "12:30" today, "учора 12:30", older "12 жовт. 12:30". */
export function useLastSeenText(
  user: { id?: string; lastSeenAt?: string | null } | null | undefined,
): string | null {
  const { t } = useTranslation();
  const now = useMinuteTick();
  const at = useLastSeen(user?.id, user?.lastSeenAt);
  if (!at || now - at.getTime() < SHOW_AFTER_MS) return null;

  const time = formatTime(at, { hour: '2-digit', minute: '2-digit' });
  const when = sameDay(at, new Date(now))
    ? time
    : sameDay(at, new Date(now - 24 * 60 * 60 * 1000))
      ? t('common.lastSeen.yesterday', { time })
      : `${formatDate(at, { day: 'numeric', month: 'short' })} ${time}`;
  return t('common.lastSeen.label', { when });
}

/**
 * "останній вхід 12:30" — nothing while the person is in the app or has been
 * out of it for less than 15 min. Live via presence events.
 *
 * Same file in is-driver and is-manager — keep them in sync.
 */
export function LastSeen({
  user,
  style,
  prefix = '',
}: {
  user: { id?: string; lastSeenAt?: string | null } | null | undefined;
  style?: StyleProp<TextStyle>;
  /** e.g. ' · ' when it follows other text on the same line. */
  prefix?: string;
}) {
  const text = useLastSeenText(user);
  if (!text) return null;
  return (
    <Text style={style} numberOfLines={1}>
      {prefix}
      {text}
    </Text>
  );
}
