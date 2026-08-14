import { Image, StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initials } from '@/lib/format';

/**
 * Round chat avatar: shows the user's uploaded photo when present, otherwise
 * falls back to their initials on a muted circle. Self-contained (clips the
 * image to the circle), so parents can overlay a presence/role badge as an
 * absolutely-positioned sibling next to it.
 */
export function ChatAvatar({
  user,
  size = 44,
}: {
  user:
    | {
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
        avatar?: string | null;
      }
    | null
    | undefined;
  size?: number;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const avatarUrl = user?.avatar?.trim();

  return (
    <View
      style={[
        styles.root,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: c.muted },
      ]}
    >
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={styles.img} />
      ) : (
        <Text style={[styles.text, { color: c.primary, fontSize: Math.round(size * 0.34) }]}>
          {initials(user)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
  text: { fontWeight: '700' },
});
