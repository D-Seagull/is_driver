import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { StyleSheet, Text } from 'react-native';

/**
 * "IS Driver 1.0.0 (7) · OTA 25.11.2026 21:37 · production" at the foot of
 * Settings. Android shows only the version NAME (1.0.0 for every build), so
 * without the build number and the running JS bundle nobody could tell which
 * code a phone actually runs. Language-neutral on purpose: no strings.
 */
export function AppVersion({ color }: { color: string }) {
  const name = Application.nativeApplicationVersion ?? '?';
  const build = Application.nativeBuildVersion ?? '?';
  const parts = [`IS Driver ${name} (${build})`];
  if (Updates.isEnabled && !Updates.isEmbeddedLaunch && Updates.createdAt) {
    const d = Updates.createdAt;
    const pad = (n: number) => String(n).padStart(2, '0');
    parts.push(
      `OTA ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  }
  if (Updates.channel) parts.push(Updates.channel);
  return (
    <Text style={[styles.text, { color }]} selectable>
      {parts.join(' · ')}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 11, textAlign: 'center', marginTop: 8, opacity: 0.7 },
});
