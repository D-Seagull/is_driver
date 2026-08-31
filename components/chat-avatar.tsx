import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Image } from 'expo-image';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initials } from '@/lib/format';

/**
 * Round chat avatar: shows the user's uploaded photo when present, otherwise
 * falls back to their initials on a muted circle. Self-contained (clips the
 * image to the circle), so parents can overlay a presence/role badge as an
 * absolutely-positioned sibling next to it.
 *
 * Uses `expo-image` with a memory+disk cache so a once-loaded avatar stays put
 * instead of re-fetching (and occasionally failing) on every render — the old
 * RN `Image` had no disk cache, which made avatars "flicker off". On a genuine
 * load error we fall back to initials rather than showing an empty circle.
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
  const [failed, setFailed] = useState(false);

  // Reset the failure flag whenever the URL changes (new user / new photo).
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);

  return (
    <View
      style={[
        styles.root,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: c.muted },
      ]}
    >
      {avatarUrl && !failed ? (
        <Image
          source={avatarUrl}
          style={styles.img}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={120}
          onError={() => setFailed(true)}
        />
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
