import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { Colors, Radius, Spacing, ThemeColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useCreateAlarm,
  useDeleteAlarm,
  useMyAlarms,
  useUpdateAlarm,
} from '@/hooks/use-alarms';
import { useUser } from '@/store/auth';
import type { Alarm, AlarmRecurrence } from '@/lib/alarms-api';

const QUICK_OFFSETS: { label: string; minutes: number }[] = [
  { label: '+5 хв', minutes: 5 },
  { label: '+15 хв', minutes: 15 },
  { label: '+30 хв', minutes: 30 },
  { label: '+1 год', minutes: 60 },
  { label: '+2 год', minutes: 120 },
];

function offsetDate(minutes: number): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes, 0, 0);
  return d;
}

const RECURRENCE_LABELS: Record<AlarmRecurrence, string> = {
  NONE: 'Один раз',
  DAILY: 'Щодня',
  WEEKLY: 'Щотижня',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

/** Render a Date as a wall-clock string the backend interprets in the
 *  *target user's* timezone — e.g. "2026-05-09T14:00:00" (no TZ suffix). */
function toWallClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:00`;
}

export default function AlarmScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const user = useUser();
  const insets = useSafeAreaInsets();
  const { data: alarms = [], isLoading, refetch } = useMyAlarms();
  const createAlarm = useCreateAlarm();
  const updateAlarm = useUpdateAlarm();
  const deleteAlarm = useDeleteAlarm();

  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state — defaults to "30 minutes from now".
  const defaultTime = useMemo(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30, 0, 0);
    return d;
  }, []);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [time, setTime] = useState<Date>(defaultTime);
  const [recurrence, setRecurrence] = useState<AlarmRecurrence>('NONE');
  // pickerMode === 'date' | 'time' | null. Both modes share one Modal so
  // behaviour is identical on iOS and Android (avoids the iOS auto-show /
  // Android auto-dismiss inconsistency).
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [pickerDraft, setPickerDraft] = useState<Date>(defaultTime);

  const openPicker = (mode: 'date' | 'time') => {
    setPickerDraft(time);
    setPickerMode(mode);
  };
  const acceptPicker = () => {
    setTime(pickerDraft);
    setPickerMode(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const resetForm = () => {
    setTitle('');
    setNote('');
    setTime(defaultTime);
    setRecurrence('NONE');
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!title.trim()) {
      Alert.alert("Тема обов'язкова");
      return;
    }
    try {
      await createAlarm.mutateAsync({
        targetUserId: user.id, // driver only ever schedules for self
        title: title.trim(),
        note: note.trim() || undefined,
        // Wall-clock — backend will interpret in the target's timezone.
        // For self-scheduling that's the device's local clock, which is what
        // we want.
        time: toWallClock(time),
        recurrence,
      });
      resetForm();
      setShowForm(false);
    } catch (e) {
      console.warn('[alarm] create failed', e);
      Alert.alert('Не вдалось створити будильник');
    }
  };

  const confirmDelete = (alarm: Alarm) => {
    Alert.alert('Видалити будильник?', alarm.title, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () => deleteAlarm.mutate(alarm.id),
      },
    ]);
  };

  /** Reuse: native action sheet with quick offsets — pick one to reschedule.
   *  Sends a full ISO string with `Z`; backend skips wall-clock conversion
   *  because the offset is already absolute. */
  const reuseAlarm = (alarm: Alarm) => {
    Alert.alert(
      'Перезапустити через…',
      alarm.title,
      [
        ...QUICK_OFFSETS.map((q) => ({
          text: q.label,
          onPress: () =>
            updateAlarm.mutate({
              id: alarm.id,
              patch: { time: offsetDate(q.minutes).toISOString() },
            }),
        })),
        { text: 'Скасувати', style: 'cancel' as const },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.lg,
          gap: Spacing.md,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {/* Header / new-alarm toggle */}
        <View style={styles.headerRow}>
          <View style={styles.headerLabel}>
            <Ionicons name="alarm-outline" size={18} color={c.foreground} />
            <Text style={[styles.headerText, { color: c.foreground }]}>
              Мої будильники ({alarms.length})
            </Text>
          </View>
          <Pressable
            onPress={() => setShowForm((v) => !v)}
            style={({ pressed }) => [
              styles.newBtn,
              {
                backgroundColor: showForm ? c.muted : c.primary,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: showForm ? c.foreground : '#fff',
                fontWeight: '600',
                fontSize: 13,
              }}
            >
              {showForm ? 'Скасувати' : '+ Новий'}
            </Text>
          </Pressable>
        </View>

        {/* Create form */}
        {showForm && (
          <View
            style={[
              styles.formCard,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Тема *
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="напр. Зателефонувати клієнту"
              placeholderTextColor={c.mutedForeground}
              style={[
                styles.input,
                { color: c.foreground, backgroundColor: c.muted },
              ]}
              maxLength={120}
            />

            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Коментар
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Деталі (необов'язково)"
              placeholderTextColor={c.mutedForeground}
              style={[
                styles.input,
                styles.multiline,
                { color: c.foreground, backgroundColor: c.muted },
              ]}
              multiline
              numberOfLines={3}
              maxLength={500}
            />

            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Коли
            </Text>
            <View style={styles.dateRow}>
              <Pressable
                onPress={() => openPicker('date')}
                style={[
                  styles.dateBtn,
                  { backgroundColor: c.muted, borderColor: c.border },
                ]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={14}
                  color={c.foreground}
                />
                <Text style={[styles.dateText, { color: c.foreground }]}>
                  {time.toLocaleDateString()}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => openPicker('time')}
                style={[
                  styles.dateBtn,
                  { backgroundColor: c.muted, borderColor: c.border },
                ]}
              >
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={c.foreground}
                />
                <Text style={[styles.dateText, { color: c.foreground }]}>
                  {time.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </Pressable>
            </View>

            {/* Quick presets — one tap to set "fire X min from now". */}
            <View style={styles.quickRow}>
              {QUICK_OFFSETS.map((q) => (
                <Pressable
                  key={q.minutes}
                  onPress={() => setTime(offsetDate(q.minutes))}
                  style={({ pressed }) => [
                    styles.quickChip,
                    {
                      backgroundColor: pressed ? c.primary : c.muted,
                      borderColor: c.border,
                    },
                  ]}
                >
                  <Text
                    style={{ color: c.foreground, fontSize: 11, fontWeight: '600' }}
                  >
                    {q.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.label, { color: c.mutedForeground }]}>
              Повтор
            </Text>
            <View style={styles.recurrenceRow}>
              {(['NONE', 'DAILY', 'WEEKLY'] as AlarmRecurrence[]).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRecurrence(r)}
                  style={[
                    styles.recurrenceChip,
                    {
                      backgroundColor:
                        recurrence === r ? c.primary : c.muted,
                      borderColor: c.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: recurrence === r ? '#fff' : c.foreground,
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {RECURRENCE_LABELS[r]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={handleCreate}
              disabled={createAlarm.isPending || !title.trim()}
              style={({ pressed }) => [
                styles.submitBtn,
                {
                  backgroundColor:
                    !title.trim() || createAlarm.isPending
                      ? c.muted
                      : c.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {createAlarm.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitText}>Створити</Text>
              )}
            </Pressable>
          </View>
        )}

        {/* Picker rendering differs per platform:
            - Android: native modal pops up by itself when the component mounts;
              we don't wrap it in our own Modal (would stack two overlays).
              The native dialog returns event.type === 'set' on confirm and
              'dismissed' on cancel.
            - iOS: spinner is inline by default — wrap in a bottom sheet with
              Cancel / Done so behaviour matches a typical mobile picker. */}
        {Platform.OS === 'android' && pickerMode !== null && (
          <DateTimePicker
            value={pickerDraft}
            mode={pickerMode}
            onChange={(event, d) => {
              setPickerMode(null);
              if (event.type === 'set' && d) setTime(d);
            }}
          />
        )}

        {Platform.OS === 'ios' && (
          <Modal
            visible={pickerMode !== null}
            transparent
            animationType="slide"
            onRequestClose={() => setPickerMode(null)}
          >
            <Pressable
              style={styles.pickerBackdrop}
              onPress={() => setPickerMode(null)}
            >
              <Pressable
                style={[
                  styles.pickerSheet,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
                onPress={() => {}}
              >
                <View style={styles.pickerHeader}>
                  <Pressable onPress={() => setPickerMode(null)} hitSlop={6}>
                    <Text style={{ color: c.mutedForeground, fontSize: 14 }}>
                      Скасувати
                    </Text>
                  </Pressable>
                  <Text style={[styles.pickerTitle, { color: c.foreground }]}>
                    {pickerMode === 'date' ? 'Оберіть дату' : 'Оберіть час'}
                  </Text>
                  <Pressable onPress={acceptPicker} hitSlop={6}>
                    <Text
                      style={{
                        color: c.primary,
                        fontSize: 14,
                        fontWeight: '700',
                      }}
                    >
                      Готово
                    </Text>
                  </Pressable>
                </View>
                {pickerMode !== null && (
                  <DateTimePicker
                    value={pickerDraft}
                    mode={pickerMode}
                    display="spinner"
                    onChange={(_, d) => {
                      if (d) setPickerDraft(d);
                    }}
                    textColor={c.foreground}
                    themeVariant={scheme === 'dark' ? 'dark' : 'light'}
                  />
                )}
              </Pressable>
            </Pressable>
          </Modal>
        )}

        {/* Alarms list */}
        {isLoading ? (
          <ActivityIndicator color={c.primary} style={{ marginTop: 24 }} />
        ) : alarms.length === 0 ? (
          <ScreenPlaceholder
            icon="alarm-outline"
            title="Немає будильників"
            subtitle='Натисни «+ Новий», щоб встановити нагадування.'
          />
        ) : (
          <FlatList
            data={alarms}
            keyExtractor={(a) => a.id}
            scrollEnabled={false}
            contentContainerStyle={{ gap: Spacing.sm }}
            renderItem={({ item }) => (
              <AlarmRow
                alarm={item}
                onDelete={() => confirmDelete(item)}
                onReuse={() => reuseAlarm(item)}
                colors={c}
              />
            )}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function AlarmRow({
  alarm,
  onDelete,
  onReuse,
  colors: c,
}: {
  alarm: Alarm;
  onDelete: () => void;
  onReuse: () => void;
  colors: ThemeColors;
}) {
  return (
    <View
      style={[
        styles.alarmCard,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          opacity: alarm.isSent ? 0.55 : 1,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={[styles.alarmTitle, { color: c.foreground }]}
          numberOfLines={2}
        >
          {alarm.title}
        </Text>
        {alarm.note ? (
          <Text
            style={[styles.alarmNote, { color: c.mutedForeground }]}
            numberOfLines={3}
          >
            {alarm.note}
          </Text>
        ) : null}
        <View style={styles.alarmMeta}>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={12} color={c.mutedForeground} />
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              {fmtDate(alarm.time)}
            </Text>
          </View>
          {alarm.recurrence !== 'NONE' && (
            <View style={styles.metaItem}>
              <Ionicons
                name="repeat-outline"
                size={12}
                color={c.mutedForeground}
              />
              <Text style={[styles.metaText, { color: c.mutedForeground }]}>
                {RECURRENCE_LABELS[alarm.recurrence]}
              </Text>
            </View>
          )}
          {alarm.creator.id !== alarm.target.id ? (
            <Text style={[styles.metaText, { color: c.mutedForeground }]}>
              від {alarm.creator.name ?? '—'}
            </Text>
          ) : null}
        </View>
      </View>
      <Pressable onPress={onReuse} hitSlop={10} style={styles.rowAction}>
        <Ionicons name="repeat-outline" size={18} color={c.foreground} />
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={10} style={styles.rowAction}>
        <Ionicons name="trash-outline" size={18} color="#ef4444" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { fontSize: 16, fontWeight: '700' },
  newBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },

  formCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 4,
  },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
    fontSize: 14,
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateText: { fontSize: 13, fontWeight: '500' },
  recurrenceRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  recurrenceChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowAction: { padding: 6 },
  submitBtn: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Spacing.lg,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  pickerTitle: { fontSize: 14, fontWeight: '600' },

  alarmCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  alarmTitle: { fontSize: 14, fontWeight: '700' },
  alarmNote: { fontSize: 12 },
  alarmMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11 },
});
