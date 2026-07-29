import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { StatusDot } from '@/components/status-dot';
import { PresenceStatusSheet } from '@/components/presence-status-sheet';
import { useAuthStore, useUser } from '@/store/auth';

// The five languages the app ships UI translations for.
const LANGUAGE_LABELS: Partial<Record<DriverLanguage, string>> = {
  EN: 'English',
  UK: 'Українська',
  PL: 'Polski',
  LT: 'Lietuvių',
  RU: 'Русский',
};

export default function DriverSettingsScreen() {
  const { t } = useTranslation();
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

  const currentStatus = (user?.status as DriverUserStatus | undefined) ?? 'ONLINE';

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
      Alert.alert(t('common.error'), t('settings.errors.saveProfile'));
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
        t('settings.errors.photoPermTitle'),
        t('settings.errors.photoPermBody'),
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
      Alert.alert(t('common.error'), t('settings.errors.uploadAvatar'));
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
      Alert.alert(t('common.error'), t('settings.errors.deleteAvatar'));
      console.warn('[settings] deleteAvatar failed', err);
    } finally {
      setAvatarBusy(null);
    }
  };

  const handleLogout = () => {
    Alert.alert(t('settings.logoutConfirm.title'), t('settings.logoutConfirm.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.logoutConfirm.confirm'),
        style: 'destructive',
        onPress: logout,
      },
    ]);
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: c.background,
          // Reserve the Android nav bar so the content area ends above it.
          // With the tighter spacing below, the page fits without scrolling.
          paddingBottom:
            Platform.OS === 'android' ? Math.max(insets.bottom, 48) : 0,
        },
      ]}
    >
      <Stack.Screen options={{ title: t('settings.title') }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          padding: Spacing.md,
          paddingBottom: Spacing.md,
          // Tighter on Android so everything clears the nav bar without a
          // scroll; roomier on iOS where there's more space.
          gap: Platform.OS === 'android' ? Spacing.sm : Spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Avatar block ─────────────────────────────────────────── */}
        <SectionCard colors={c} title={t('settings.avatar.title')}>
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
                {fullName(user) || t('settings.driverFallback')}
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
                    {user?.avatar ? t('settings.avatar.change') : t('common.upload')}
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
                      {t('settings.avatar.remove')}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </SectionCard>

        {/* ── Status ───────────────────────────────────────────────── */}
        <SectionCard colors={c} title={t('settings.status.title')}>
          <Pressable
            onPress={() => setStatusPickerOpen(true)}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                opacity: pressed ? 0.85 : 1,
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
              {t(`status.${currentStatus}`)}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={c.mutedForeground}
            />
          </Pressable>
        </SectionCard>

        {/* ── Name fields ──────────────────────────────────────────── */}
        <SectionCard colors={c} title={t('settings.name.title')}>
          <View style={{ gap: Spacing.md }}>
            <FieldLabel colors={c}>{t('settings.name.first')}</FieldLabel>
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
              placeholder={t('settings.name.firstPlaceholder')}
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="words"
            />
            <FieldLabel colors={c}>{t('settings.name.last')}</FieldLabel>
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
              placeholder={t('settings.name.lastPlaceholder')}
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="words"
            />
          </View>
        </SectionCard>

        {/* ── Language ─────────────────────────────────────────────── */}
        <SectionCard colors={c} title={t('settings.language.title')}>
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
              {LANGUAGE_LABELS[language] ?? 'English'}
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
                {t('settings.saveChanges')}
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
              {t('settings.saved')}
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
            {t('settings.logout')}
          </Text>
        </Pressable>
      </ScrollView>

      {/* ── Status picker — shared sheet with the full set of statuses
          (Online / Busy / Away / Sleep ▶ / Vacation ▶) ── */}
      <PresenceStatusSheet
        open={statusPickerOpen}
        onClose={() => setStatusPickerOpen(false)}
      />

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
            style={[
              styles.modalSheet,
              {
                backgroundColor: c.card,
                paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.xl,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text
              style={[styles.modalTitle, { color: c.foreground }]}
            >
              {t('settings.language.pick')}
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
    </View>
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
    <View style={{ gap: Platform.OS === 'android' ? Spacing.xs : Spacing.sm }}>
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
    width: Platform.OS === 'android' ? 60 : 72,
    height: Platform.OS === 'android' ? 60 : 72,
    borderRadius: Platform.OS === 'android' ? 30 : 36,
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
    paddingVertical: Platform.OS === 'android' ? 8 : 10,
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
