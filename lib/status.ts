import { DriverUserStatus } from './auth-api';

export type DisplayStatus = DriverUserStatus | 'OFFLINE';

/**
 * Resolves what to render in the indicator dot. OFFLINE comes from the
 * viewer's online-flag, not from the wire payload — backend only stores
 * the three presence options. BUSY/SLEEP timers that already expired
 * collapse to ONLINE here as a safety net.
 */
export function resolveDisplayStatus(
  user:
    | {
        status?: DriverUserStatus | null;
        statusUntil?: string | null;
      }
    | null
    | undefined,
  isOnline: boolean,
  // Offline but seen within the last week → amber "away"; older → grey OFFLINE.
  isAway = false,
): DisplayStatus {
  if (!isOnline) return isAway ? 'AWAY' : 'OFFLINE';
  const stored = user?.status ?? 'ONLINE';
  if (stored === 'ONLINE') return 'ONLINE';
  if (user?.statusUntil) {
    const until = new Date(user.statusUntil).getTime();
    if (Number.isFinite(until) && until <= Date.now()) return 'ONLINE';
  }
  return stored;
}

export const STATUS_HEX: Record<DisplayStatus, string> = {
  ONLINE: '#10B981',
  BUSY: '#EF4444',
  AWAY: '#F59E0B',
  SLEEP: '#6366F1',
  VACATION: '#EAB308',
  OFFLINE: '#9CA3AF',
};

// Human labels live in i18n under the `status.*` namespace (keyed by the
// DisplayStatus value), rendered with `t('status.' + status)` at call sites.
