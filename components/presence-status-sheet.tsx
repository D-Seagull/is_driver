import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DriverUserStatus, updateMe } from '@/lib/auth-api';
import { STATUS_HEX } from '@/lib/status';
import { useAuthStore } from '@/store/auth';

// Sleep presets — EU rest-break convention (9 h short rest, 11 h regular
// rest) plus a tighter "power nap" and an indefinite mode for end-of-day.
// `key` resolves to the i18n label under presence.sleepPresets.*
const SLEEP_PRESETS: { key: string; hours: number }[] = [
  { key: 'min30', hours: 0.5 },
  { key: 'hours2', hours: 2 },
  { key: 'shortRest', hours: 9 },
  { key: 'regularRest', hours: 11 },
];

// Vacation presets — day-based, since rest stretches across more than
// one rest cycle. Drivers can override with the "no limit" row for an
// open-ended break. `key` resolves to presence.vacationPresets.*
const VACATION_PRESETS: { key: string; hours: number }[] = [
  { key: 'day1', hours: 24 },
  { key: 'days3', hours: 72 },
  { key: 'week1', hours: 168 },
  { key: 'weeks2', hours: 336 },
];

/**
 * Reusable presence-status sheet — Online / Busy / Sleep ▶, with a
 * second sheet for sleep duration. Mounts the modals as the consumer
 * needs (drawer footer row, settings page row, manager profile, …) and
 * does its own optimistic store update so the dot flips before the
 * server round-trip completes.
 */
export function PresenceStatusSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  // Keep the sheet's last row clear of the Android nav bar (edge-to-edge).
  const sheetPadBottom = Math.max(insets.bottom, Spacing.sm) + Spacing.xl;
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const currentStatus =
    (user?.status as DriverUserStatus | undefined) ?? 'ONLINE';
  const [sleepOpen, setSleepOpen] = useState(false);
  const [vacationOpen, setVacationOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyStatus = async (status: DriverUserStatus, hours?: number) => {
    setBusy(true);
    try {
      // Optimistic — the avatar dot flips instantly.
      const current = useAuthStore.getState().user;
      const statusUntil =
        status !== 'ONLINE' && hours
          ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
          : null;
      if (current) {
        setUser({ ...current, status, statusUntil });
      }
      const me = await updateMe({ status, statusUntil });
      setUser(me);
    } catch (err) {
      Alert.alert(t('common.error'), t('presence.updateError'));
      console.warn('[presence-status-sheet] updateMe failed', err);
    } finally {
      setBusy(false);
    }
  };

  const closeAll = () => {
    setSleepOpen(false);
    setVacationOpen(false);
    onClose();
  };

  return (
    <>
      {/* Main status sheet */}
      <Modal
        transparent
        visible={open && !sleepOpen && !vacationOpen}
        animationType="fade"
        onRequestClose={closeAll}
      >
        <Pressable style={styles.backdrop} onPress={closeAll}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.card, paddingBottom: sheetPadBottom }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.title, { color: c.foreground }]}>
              {t('presence.pickStatus')}
            </Text>
            {(['ONLINE', 'BUSY', 'AWAY'] as const).map((s) => {
              const selected = currentStatus === s;
              return (
                <Pressable
                  key={s}
                  disabled={busy}
                  onPress={() => {
                    closeAll();
                    applyStatus(s);
                  }}
                  style={({ pressed }) => [
                    styles.item,
                    {
                      backgroundColor:
                        selected || pressed ? c.muted : 'transparent',
                    },
                  ]}
                >
                  <View style={styles.itemLeft}>
                    <View
                      style={[styles.dot, { backgroundColor: STATUS_HEX[s] }]}
                    />
                    <Text style={[styles.itemText, { color: c.foreground }]}>
                      {t(`status.${s}`)}
                    </Text>
                  </View>
                  {selected && (
                    <Ionicons name="checkmark" size={20} color={c.primary} />
                  )}
                </Pressable>
              );
            })}
            <Pressable
              disabled={busy}
              onPress={() => setSleepOpen(true)}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor:
                    currentStatus === 'SLEEP' || pressed
                      ? c.muted
                      : 'transparent',
                },
              ]}
            >
              <View style={styles.itemLeft}>
                <View style={[styles.dot, { backgroundColor: STATUS_HEX.SLEEP }]}>
                  <Ionicons name="moon" size={7} color="#fff" />
                </View>
                <Text style={[styles.itemText, { color: c.foreground }]}>
                  {t('presence.sleepEllipsis')}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={c.mutedForeground}
              />
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => setVacationOpen(true)}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor:
                    currentStatus === 'VACATION' || pressed
                      ? c.muted
                      : 'transparent',
                },
              ]}
            >
              <View style={styles.itemLeft}>
                <View style={[styles.dot, { backgroundColor: STATUS_HEX.VACATION }]}>
                  <Text style={{ fontSize: 7 }}>🌴</Text>
                </View>
                <Text style={[styles.itemText, { color: c.foreground }]}>
                  {t('presence.vacationEllipsis')}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={c.mutedForeground}
              />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sleep duration sheet */}
      <Modal
        transparent
        visible={open && sleepOpen}
        animationType="fade"
        onRequestClose={closeAll}
      >
        <Pressable style={styles.backdrop} onPress={closeAll}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.card, paddingBottom: sheetPadBottom }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.title, { color: c.foreground }]}>
              {t('presence.howLong')}
            </Text>
            {SLEEP_PRESETS.map((p) => (
              <Pressable
                key={p.key}
                disabled={busy}
                onPress={() => {
                  closeAll();
                  applyStatus('SLEEP', p.hours);
                }}
                style={({ pressed }) => [
                  styles.item,
                  { backgroundColor: pressed ? c.muted : 'transparent' },
                ]}
              >
                <Text style={[styles.itemText, { color: c.foreground }]}>
                  {t(`presence.sleepPresets.${p.key}`)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              disabled={busy}
              onPress={() => {
                closeAll();
                applyStatus('SLEEP');
              }}
              style={({ pressed }) => [
                styles.item,
                { backgroundColor: pressed ? c.muted : 'transparent' },
              ]}
            >
              <Text style={[styles.itemText, { color: c.foreground }]}>
                {t('presence.noLimit')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Vacation duration sheet */}
      <Modal
        transparent
        visible={open && vacationOpen}
        animationType="fade"
        onRequestClose={closeAll}
      >
        <Pressable style={styles.backdrop} onPress={closeAll}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.card, paddingBottom: sheetPadBottom }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.title, { color: c.foreground }]}>
              {t('presence.howLong')}
            </Text>
            {VACATION_PRESETS.map((p) => (
              <Pressable
                key={p.key}
                disabled={busy}
                onPress={() => {
                  closeAll();
                  applyStatus('VACATION', p.hours);
                }}
                style={({ pressed }) => [
                  styles.item,
                  { backgroundColor: pressed ? c.muted : 'transparent' },
                ]}
              >
                <Text style={[styles.itemText, { color: c.foreground }]}>
                  {t(`presence.vacationPresets.${p.key}`)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              disabled={busy}
              onPress={() => {
                closeAll();
                applyStatus('VACATION');
              }}
              style={({ pressed }) => [
                styles.item,
                { backgroundColor: pressed ? c.muted : 'transparent' },
              ]}
            >
              <Text style={[styles.itemText, { color: c.foreground }]}>
                {t('presence.noLimit')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: Radius.sm,
  },
  itemLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemText: { fontSize: 15 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
