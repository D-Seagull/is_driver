import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  TRIP_STATUSES,
  TRIP_STATUS_COLORS,
  TRIP_STATUS_LABELS,
  TripStatus,
} from '@/constants/trip-status';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function StatusBadge({ status }: { status: TripStatus }) {
  const tone = TRIP_STATUS_COLORS[status] ?? TRIP_STATUS_COLORS.ASSIGNED;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone.bg, borderColor: tone.border, borderRadius: Radius.lg },
      ]}
    >
      <Text style={[styles.badgeText, { color: tone.fg }]}>
        {TRIP_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

type Anchor = { x: number; y: number; width: number; height: number };

export function StatusPicker({
  value,
  onChange,
}: {
  value: TripStatus;
  onChange: (next: TripStatus) => void;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const openMenu = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  };

  // Position dropdown directly under the trigger; flip up if not enough room.
  const screenH = Dimensions.get('window').height;
  const screenW = Dimensions.get('window').width;
  const menuMinWidth = 180;
  let menuStyle: { top: number; left: number; minWidth: number } | null = null;

  if (anchor) {
    const desiredWidth = Math.max(anchor.width, menuMinWidth);
    const estimatedHeight = TRIP_STATUSES.length * 44 + 16;
    const fitsBelow = anchor.y + anchor.height + estimatedHeight + 16 < screenH;
    const top = fitsBelow
      ? anchor.y + anchor.height + 4
      : Math.max(8, anchor.y - estimatedHeight - 4);
    const left = Math.min(
      Math.max(8, anchor.x),
      screenW - desiredWidth - 8,
    );
    menuStyle = { top, left, minWidth: desiredWidth };
  }

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={openMenu}
        style={({ pressed }) => [styles.trigger, { opacity: pressed ? 0.85 : 1 }]}
      >
        <StatusBadge status={value} />
        <Ionicons name="chevron-down" size={14} color={c.mutedForeground} />
      </Pressable>

      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {menuStyle && (
            <Pressable
              onPress={() => {}}
              style={[
                styles.menu,
                menuStyle,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                  borderRadius: Radius.md,
                  shadowColor: '#000',
                },
              ]}
            >
              {TRIP_STATUSES.map((s) => {
                const tone = TRIP_STATUS_COLORS[s];
                const selected = s === value;
                return (
                  <Pressable
                    key={s}
                    onPress={() => {
                      onChange(s);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      {
                        backgroundColor:
                          pressed || selected ? c.muted : 'transparent',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: tone.fg, borderColor: tone.border },
                      ]}
                    />
                    <Text style={[styles.rowLabel, { color: c.foreground }]}>
                      {TRIP_STATUS_LABELS[s]}
                    </Text>
                    {selected && (
                      <Ionicons name="checkmark" size={16} color={c.primary} />
                    )}
                  </Pressable>
                );
              })}
            </Pressable>
          )}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menu: {
    position: 'absolute',
    paddingVertical: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 1,
  },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
});
