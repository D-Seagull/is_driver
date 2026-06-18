import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, ThemeColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  DriverLanguage,
  DriverUserStatus,
  deleteAvatar,
  updateMe,
  uploadAvatar,
} from '@/lib/auth-api';
import { fullName, initials } from '@/lib/format';
import { STATUS_HEX, STATUS_LABEL } from '@/lib/status';
import { StatusDot } from '@/components/status-dot';
import { useAuthStore, useUser } from '@/store/auth';

// Sleep presets for drivers — anchored on the EU rest-break convention
// (9 h short rest, 11 h regular rest) plus a tighter "power nap" option
// and a free-form custom that just defaults to 30 min.
const SLEEP_PRESETS: { label: string; hours: number }[] = [
  { label: '30 хв', hours: 0.5 },
  { label: '2 години', hours: 2 },
  { label: '9 годин (короткий відпочинок)', hours: 9 },
  { label: '11 годин (регулярний відпочинок)', hours: 11 },
];

const LANGUAGE_LABELS: Record<DriverLanguage, string> = {
  UK: 'Українська',
  EN: 'English',
  PL: 'Polski',
  LT: 'Lietuvių',
  UZ: "O'zbekcha",
  KZ: 'Қазақша',
  HI: 'हिन्दी',
  RU: 'Русский',
};

export default function DriverSettingsScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const user = useUser();
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [language, setLanguage] = useState<DriverLanguage>(
    (user?.language as DriverLanguage | undefined) ?? 'EN',
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState<'upload' | 'delete' | null>(
    null,
  );
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [sleepPickerOpen, setSleepPickerOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const currentStatus = (user?.status as DriverUserStatus | undefined) ?? 'ONLINE';

  const applyStatus = async (
    status: DriverUserStatus,
    hours?: number,
  ) => {
    setStatusBusy(true);
    try {
      const me = await updateMe({
        status,
        statusUntil:
          status !== 'ONLINE' && hours
            ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
            : null,
      });
      setUser(me);
    } catch (err) {
      Alert.alert('Помилка', 'Не вдалось оновити статус.');
      console.warn('[settings] updateMe(status) failed', err);
    } finally {
      setStatusBusy(false);
    }
  };

  // Sync when the underlying user changes (e.g. after avatar upload).
  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setLanguage((user.language as DriverLanguage | undefined) ?? 'EN');
  }, [user]);

  const isProfileDirty =
    firstName.trim() !== (user?.firstName ?? '') ||
    (lastName.trim() || null) !== (user?.lastName ?? null) ||
    language !== ((user?.language as DriverLanguage | undefined) ?? 'EN');
  const canSaveProfile =
    firstName.trim().length >= 1 && isProfileDirty && !savingProfile;

  const handleSaveProfile = async () => {
    if (!canSaveProfile) return;
    setSavingProfile(true);
    try {
      const me = await updateMe({
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        language,
      });
      setUser(me);
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 2000);
    } catch (err) {
      Alert.alert('Помилка', 'Не вдалось зберегти зміни.');
      console.warn('[settings] updateMe failed', err);
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePickAvatar = async () => {
    if (avatarBusy) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Доступ до фото',
        'Дозволь доступ до галереї щоб обрати фото профілю.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setAvatarBusy('upload');
    try {
      const me = await uploadAvatar({
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      });
      setUser(me);
    } catch (err) {
      Alert.alert('Помилка', 'Не вдалось завантажити фото.');
      console.warn('[settings] uploadAvatar failed', err);
    } finally {
      setAvatarBusy(null);
    }
  };

  const handleRemoveAvatar = async () => {
    if (avatarBusy) return;
    setAvatarBusy('delete');
    try {
      const me = await deleteAvatar();
      setUser(me);
    } catch (err) {
      Alert.alert('Помилка', 'Не вдалось видалити фото.');
      console.warn('[settings] deleteAvatar failed', err);
    } finally {
      setAvatarBusy(null);
    }
  };

  const handleLogout = () => {
    Alert.alert('Вихід з акаунту', 'Точно вийти?', [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Вийти', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView
        contentContainerStyle={{
          padding: Spacing.md,
          paddingBottom: insets.bottom + Spacing.lg,
          gap: Spacing.lg,
        }}
      >
        {/* ── Avatar block ─────────────────────────────────────────── */}
        <SectionCard colors={c} title="Фото профілю">
          <View style={styles.avatarRow}>
            <View
              style={[styles.avatarWrap, { backgroundColor: c.muted }]}
            >
              {user?.avatar ? (
                <Image
                  source={{ uri: user.avatar }}
                  style={styles.avatarImg}
                />
              ) : (
                <Text
                  style={[
                    styles.avatarText,
                    { color: c.mutedForeground },
                  ]}
                >
                  {initials(user)}
                </Text>
              )}
              {avatarBusy && (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator size="small" color={c.primary} />
                </View>
              )}
            </View>
            <View style={{ flex: 1, gap: Spacing.xs }}>
              <Text style={[styles.name, { color: c.foreground }]}>
                {fullName(user) || 'Driver'}
              </Text>
              <Text
                style={[styles.role, { color: c.mutedForeground }]}
              >
                {user?.phone ?? user?.email ?? user?.role}
              </Text>
              <View style={styles.avatarButtons}>
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={!!avatarBusy}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    {
                      backgroundColor: c.primary,
                      opacity: pressed || avatarBusy ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name="camera-outline"
                    size={14}
                    color={c.primaryForeground}
                  />
                  <Text
                    style={[
                      styles.actionText,
                      { color: c.primaryForeground },
                    ]}
                  >
                    {user?.avatar ? 'Змінити' : 'Завантажити'}
                  </Text>
                </Pressable>
                {user?.avatar && (
                  <Pressable
                    onPress={handleRemoveAvatar}
                    disabled={!!avatarBusy}
                    style={({ pressed }) => [
                      styles.actionBtnOutline,
                      {
                        borderColor: c.border,
                        opacity: pressed || avatarBusy ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={14}
                      color={c.foreground}
                    />
                    <Text
                      style={[
                        styles.actionText,
                        { color: c.foreground },
                      ]}
                    >
                      Прибрати
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </SectionCard>

        {/* ── Status ───────────────────────────────────────────────── */}
        <SectionCard colors={c} title="Статус">
          <Pressable
            onPress={() => setStatusPickerOpen(true)}
            disabled={statusBusy}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                opacity: pressed || statusBusy ? 0.85 : 1,
              },
            ]}
          >
            <StatusDot
              user={user}
              isOnline
              size={12}
              ring={c.card}
            />
            <Text style={[styles.rowText, { color: c.foreground }]}>
              {STATUS_LABEL[currentStatus] ?? 'Online'}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={c.mutedForeground}
            />
          </Pressable>
        </SectionCard>

        {/* ── Name fields ──────────────────────────────────────────── */}
        <SectionCard colors={c} title="Імʼя та прізвище">
          <View style={{ gap: Spacing.md }}>
            <FieldLabel colors={c}>Імʼя</FieldLabel>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                  color: c.foreground,
                },
              ]}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Іван"
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="words"
            />
            <FieldLabel colors={c}>Прізвище (необовʼязково)</FieldLabel>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: c.card,
                  borderColor: c.border,
                  color: c.foreground,
                },
              ]}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Петренко"
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="words"
            />
          </View>
        </SectionCard>

        {/* ── Language ─────────────────────────────────────────────── */}
        <SectionCard colors={c} title="Мова">
          <Pressable
            onPress={() => setLangPickerOpen(true)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name="language-outline"
              size={18}
              color={c.foreground}
            />
            <Text style={[styles.rowText, { color: c.foreground }]}>
              {LANGUAGE_LABELS[language]}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={c.mutedForeground}
            />
          </Pressable>
        </SectionCard>

        {/* ── Save button + saved hint ─────────────────────────────── */}
        <View style={{ gap: Spacing.xs }}>
          <Pressable
            onPress={handleSaveProfile}
            disabled={!canSaveProfile}
            style={({ pressed }) => [
              styles.saveBtn,
              {
                backgroundColor: canSaveProfile ? c.primary : c.muted,
                opacity: pressed && canSaveProfile ? 0.85 : 1,
              },
            ]}
          >
            {savingProfile ? (
              <ActivityIndicator color={c.primaryForeground} />
            ) : (
              <Text
                style={[
                  styles.saveText,
                  {
                    color: canSaveProfile
                      ? c.primaryForeground
                      : c.mutedForeground,
                  },
                ]}
              >
                Зберегти зміни
              </Text>
            )}
          </Pressable>
          {savedHint && (
            <Text
              style={[
                styles.savedHint,
                { color: c.primary },
              ]}
            >
              Зміни збережено ✓
            </Text>
          )}
        </View>

        {/* ── Logout block ─────────────────────────────────────────── */}
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.logoutBtn,
            {
              backgroundColor: c.card,
              borderColor: c.destructive ?? '#dc2626',
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons
            name="log-out-outline"
            size={18}
            color={c.destructive ?? '#dc2626'}
          />
          <Text
            style={[
              styles.logoutText,
              { color: c.destructive ?? '#dc2626' },
            ]}
          >
            Вийти з акаунту
          </Text>
        </Pressable>
      </ScrollView>

      {/* ── Status picker modal ────────────────────────────────────── */}
      <Modal
        transparent
        visible={statusPickerOpen}
        animationType="fade"
        onRequestClose={() => setStatusPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setStatusPickerOpen(false)}
        >
          <Pressable
            style={[styles.modalSheet, { backgroundColor: c.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: c.foreground }]}>
              Виберіть статус
            </Text>
            {(['ONLINE', 'BUSY'] as const).map((s) => {
              const selected = currentStatus === s;
              return (
                <Pressable
                  key={s}
                  onPress={() => {
                    setStatusPickerOpen(false);
                    applyStatus(s);
                  }}
                  style={({ pressed }) => [
                    styles.modalItem,
                    {
                      backgroundColor:
                        selected || pressed ? c.muted : 'transparent',
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: STATUS_HEX[s],
                      }}
                    />
                    <Text style={[styles.modalItemText, { color: c.foreground }]}>
                      {STATUS_LABEL[s]}
                    </Text>
                  </View>
                  {selected && (
                    <Ionicons name="checkmark" size={20} color={c.primary} />
                  )}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => {
                setStatusPickerOpen(false);
                setSleepPickerOpen(true);
              }}
              style={({ pressed }) => [
                styles.modalItem,
                {
                  backgroundColor:
                    currentStatus === 'SLEEP' || pressed ? c.muted : 'transparent',
                },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: STATUS_HEX.SLEEP,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name="moon" size={7} color="#fff" />
                </View>
                <Text style={[styles.modalItemText, { color: c.foreground }]}>
                  Сплю…
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

      {/* ── Sleep duration picker ─────────────────────────────────── */}
      <Modal
        transparent
        visible={sleepPickerOpen}
        animationType="fade"
        onRequestClose={() => setSleepPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSleepPickerOpen(false)}
        >
          <Pressable
            style={[styles.modalSheet, { backgroundColor: c.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.modalTitle, { color: c.foreground }]}>
              На скільки?
            </Text>
            {SLEEP_PRESETS.map((p) => (
              <Pressable
                key={p.label}
                onPress={() => {
                  setSleepPickerOpen(false);
                  applyStatus('SLEEP', p.hours);
                }}
                style={({ pressed }) => [
                  styles.modalItem,
                  { backgroundColor: pressed ? c.muted : 'transparent' },
                ]}
              >
                <Text style={[styles.modalItemText, { color: c.foreground }]}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => {
                setSleepPickerOpen(false);
                applyStatus('SLEEP');
              }}
              style={({ pressed }) => [
                styles.modalItem,
                { backgroundColor: pressed ? c.muted : 'transparent' },
              ]}
            >
              <Text style={[styles.modalItemText, { color: c.foreground }]}>
                Без обмеження
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Language picker modal ──────────────────────────────────── */}
      <Modal
        transparent
        visible={langPickerOpen}
        animationType="fade"
        onRequestClose={() => setLangPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setLangPickerOpen(false)}
        >
          <Pressable
            style={[styles.modalSheet, { backgroundColor: c.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text
              style={[styles.modalTitle, { color: c.foreground }]}
            >
              Виберіть мову
            </Text>
            {(Object.entries(LANGUAGE_LABELS) as [DriverLanguage, string][]).map(
              ([value, label]) => {
                const selected = value === language;
                return (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setLanguage(value);
                      setLangPickerOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.modalItem,
                      {
                        backgroundColor: selected
                          ? c.muted
                          : pressed
                            ? c.muted
                            : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={[styles.modalItemText, { color: c.foreground }]}
                    >
                      {label}
                    </Text>
                    {selected && (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={c.primary}
                      />
                    )}
                  </Pressable>
                );
              },
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function SectionCard({
  title,
  children,
  colors: c,
}: {
  title: string;
  children: React.ReactNode;
  colors: ThemeColors;
}) {
  return (
    <View style={{ gap: Spacing.sm }}>
      <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      <View
        style={[
          styles.sectionBody,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function FieldLabel({
  children,
  colors: c,
}: {
  children: React.ReactNode;
  colors: ThemeColors;
}) {
  return (
    <Text style={[styles.fieldLabel, { color: c.mutedForeground }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sectionTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sectionBody: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { fontSize: 24, fontWeight: '700' },
  avatarBusy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  name: { fontSize: 16, fontWeight: '700' },
  role: { fontSize: 13 },
  avatarButtons: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  actionBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  actionText: { fontSize: 12, fontWeight: '600' },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  rowText: { flex: 1, fontSize: 15 },
  saveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: Radius.md,
  },
  saveText: { fontSize: 15, fontWeight: '700' },
  savedHint: { fontSize: 12, textAlign: 'center' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginTop: Spacing.md,
  },
  logoutText: { fontSize: 15, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  modalTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  modalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: Radius.sm,
  },
  modalItemText: { fontSize: 15 },
});
