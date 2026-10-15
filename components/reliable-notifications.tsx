import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, type ThemeColors } from '@/constants/theme';

const PACKAGE = Constants.expoConfig?.android?.package ?? '';

async function open(action: IntentLauncher.ActivityAction, withPackage = false) {
  try {
    await IntentLauncher.startActivityAsync(
      action,
      withPackage ? { extra: { 'android.provider.extra.APP_PACKAGE': PACKAGE } } : undefined,
    );
  } catch {
    // Some firmwares hide a screen — the app's own settings page is the
    // closest thing everywhere.
    void Linking.openSettings();
  }
}

/**
 * Settings → "Reliable notifications" (Android only). Shortcuts to the
 * system screens that decide whether a push / the alarm actually reaches a
 * locked phone — things only the user can switch on:
 *  - this app's notifications (lock screen, pop-up, sound per channel);
 *  - "Do not disturb" access, so the alarm channel rings through DND;
 *  - battery: no restrictions, so the phone doesn't hold pushes back.
 * Plus a note on the Xiaomi-style extras (autostart, wake screen).
 */
export function ReliableNotifications({
  colors: c,
  alarm = false,
}: {
  colors: ThemeColors;
  /** Show the Do-not-disturb row: only the driver app has an alarm. */
  alarm?: boolean;
}) {
  const { t } = useTranslation();
  if (Platform.OS !== 'android') return null;

  const rows: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    {
      icon: 'notifications-outline',
      label: t('settings.reliable.notifications'),
      onPress: () => void open(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, true),
    },
    ...(alarm
      ? [
          {
            icon: 'alarm-outline' as const,
            label: t('settings.reliable.dnd'),
            onPress: () =>
              void open(IntentLauncher.ActivityAction.NOTIFICATION_POLICY_ACCESS_SETTINGS),
          },
        ]
      : []),
    {
      icon: 'battery-charging-outline',
      label: t('settings.reliable.battery'),
      onPress: () =>
        void open(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
    },
  ];

  return (
    <View style={{ gap: Spacing.sm }}>
      {rows.map((r) => (
        <Pressable
          key={r.icon}
          onPress={r.onPress}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name={r.icon} size={18} color={c.foreground} />
          <Text style={[styles.text, { color: c.foreground }]}>{r.label}</Text>
          <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
        </Pressable>
      ))}
      <Text style={[styles.hint, { color: c.mutedForeground }]}>
        {t('settings.reliable.hint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, fontSize: 14 },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: Spacing.xs },
});
