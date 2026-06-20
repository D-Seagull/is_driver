import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { DriverUserStatus } from '@/lib/auth-api';
import {
  resolveDisplayStatus,
  STATUS_HEX,
  type DisplayStatus,
} from '@/lib/status';
import { useIsUserOnline } from '@/hooks/use-presence';

interface StatusDotProps {
  user:
    | {
        id?: string;
        status?: DriverUserStatus | null;
        statusUntil?: string | null;
      }
    | null
    | undefined;
  /** Override for the live presence lookup. Omit for the common case
   *  where we read from the shared presence store. */
  isOnline?: boolean;
  size?: number;
  /** Background colour for the outer ring — pass the parent surface so the
   *  dot looks like it sits on top with a hairline gap. */
  ring?: string;
}

/**
 * Tiny presence dot for native lists. SLEEP renders with a moon glyph
 * inside; the rest are solid fills. Pure-RN so we can drop it on any
 * existing Image / Text avatar without touching layout.
 */
export function StatusDot({ user, isOnline, size = 10, ring = '#000' }: StatusDotProps) {
  const livePresence = useIsUserOnline(user?.id);
  const effectiveOnline = isOnline ?? livePresence;
  const status: DisplayStatus = resolveDisplayStatus(user, effectiveOnline);
  const inner = size;
  const outer = inner + 4;
  return (
    <View
      style={[
        styles.outer,
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          backgroundColor: ring,
        },
      ]}
    >
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: STATUS_HEX[status],
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {status === 'SLEEP' && (
          <Ionicons
            name="moon"
            size={Math.max(6, Math.floor(inner * 0.7))}
            color="#fff"
          />
        )}
        {status === 'VACATION' && (
          // Lucide-style palm tree isn't in Ionicons; emoji renders crisply
          // on both iOS and Android at this size and keeps us from having
          // to ship a second icon font just for one glyph.
          <Text style={{ fontSize: Math.max(6, Math.floor(inner * 0.8)) }}>
            🌴
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
