import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { usePathname } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Radius, Spacing, ThemeColors } from '@/constants/theme';
import { useThemeMode } from '@/hooks/use-theme';
import { reportBug, type BugScreenshot } from '@/lib/bug-report-api';
import { NotificationBell } from './notification-bell';

const MAX_SCREENSHOTS = 5;

/**
 * Right-side header cluster shared by every drawer screen: bug report, unread
 * bell, theme toggle — in that fixed order across all three IS Fleet apps.
 */
export function HeaderActions({ colors: c }: { colors: ThemeColors }) {
  const { resolved, toggle } = useThemeMode();

  return (
    <View style={styles.row}>
      <BugReportButton colors={c} />
      <NotificationBell colors={c} />
      <Pressable onPress={toggle} hitSlop={8} style={styles.iconBtn}>
        <Ionicons
          name={resolved === 'dark' ? 'sunny-outline' : 'moon-outline'}
          size={19}
          color={c.foreground}
        />
      </Pressable>
    </View>
  );
}

function BugReportButton({ colors: c }: { colors: ThemeColors }) {
  const { t } = useTranslation();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [shots, setShots] = useState<BugScreenshot[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setDescription('');
    setShots([]);
    setSubmitting(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('bugReport.permissionTitle'), t('bugReport.permissionBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setShots((prev) =>
      [
        ...prev,
        { uri: asset.uri, name: asset.fileName, type: asset.mimeType },
      ].slice(0, MAX_SCREENSHOTS),
    );
  };

  const removeShot = (i: number) =>
    setShots((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    try {
      await reportBug(description.trim(), shots, pathname);
      close();
      Alert.alert(t('bugReport.sentTitle'), t('bugReport.sent'));
    } catch {
      setSubmitting(false);
      Alert.alert(t('bugReport.errorTitle'), t('bugReport.error'));
    }
  };

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={styles.iconBtn}>
        <Ionicons name="bug-outline" size={19} color="rgba(239,68,68,0.7)" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.title, { color: c.foreground }]}>
              {t('bugReport.title')}
            </Text>
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
              {t('bugReport.subtitle')}
            </Text>

            <TextInput
              style={[
                styles.input,
                { backgroundColor: c.background, borderColor: c.border, color: c.foreground },
              ]}
              value={description}
              onChangeText={setDescription}
              placeholder={t('bugReport.placeholder')}
              placeholderTextColor={c.mutedForeground}
              multiline
            />

            {shots.length > 0 && (
              <View style={styles.thumbs}>
                {shots.map((s, i) => (
                  <View key={`${s.uri}-${i}`} style={styles.thumbWrap}>
                    <Image source={{ uri: s.uri }} style={styles.thumb} />
                    <Pressable
                      onPress={() => removeShot(i)}
                      hitSlop={6}
                      style={styles.thumbX}
                    >
                      <Ionicons name="close" size={12} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.actions}>
              <Pressable
                onPress={pickImage}
                disabled={shots.length >= MAX_SCREENSHOTS}
                style={({ pressed }) => [
                  styles.attachBtn,
                  { borderColor: c.border, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Ionicons name="image-outline" size={16} color={c.foreground} />
                <Text style={[styles.attachText, { color: c.foreground }]}>
                  {t('bugReport.attach')}
                </Text>
              </Pressable>

              <Pressable
                onPress={submit}
                disabled={!description.trim() || submitting}
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor: description.trim() ? c.primary : c.muted,
                    opacity: pressed && description.trim() ? 0.85 : 1,
                  },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={c.primaryForeground} size="small" />
                ) : (
                  <Text
                    style={[
                      styles.sendText,
                      { color: description.trim() ? c.primaryForeground : c.mutedForeground },
                    ]}
                  >
                    {t('bugReport.send')}
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 13 },
  input: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    fontSize: 15,
    textAlignVertical: 'top',
    marginTop: Spacing.xs,
  },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  thumbWrap: { position: 'relative' },
  thumb: { width: 56, height: 56, borderRadius: Radius.sm },
  thumbX: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  attachText: { fontSize: 14, fontWeight: '500' },
  sendBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontSize: 15, fontWeight: '600' },
});
