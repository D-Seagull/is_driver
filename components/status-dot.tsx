import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { DriverUserStatus } from '@/lib/auth-api';
import {
  resolveDisplayStatus,
  STATUS_HEX,
  type DisplayStatus,
} from '@/lib/status';

interface StatusDotProps {
  user:
    | {
        status?: DriverUserStatus | null;
        statusUntil?: string | null;
      }
    | null
    | undefined;
  isOnline: boolean;
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
  const status: DisplayStatus = resolveDisplayStatus(user, isOnline);
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
