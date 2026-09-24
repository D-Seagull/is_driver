import { Image, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Fixed wallpaper behind the messages (doesn't scroll). Mirrors is-manager.
// `trip` uses the chat2 art (a bright photo) shown whole (contain); DM + group
// chats use the original chat-bg as a subtle dimmed cover.
const CHAT_BG = require('../assets/images/chat-bg.png');
const TRIP_BG = require('../assets/images/chat2.png');

export function ChatBackground({ variant = 'chat' }: { variant?: 'chat' | 'trip' }) {
  const scheme = useColorScheme() ?? 'light';
  const dark = scheme === 'dark';
  const isTrip = variant === 'trip';
  return (
    <>
      <Image
        source={isTrip ? TRIP_BG : CHAT_BG}
        resizeMode={isTrip ? 'contain' : 'cover'}
        style={[
          StyleSheet.absoluteFill,
          { opacity: isTrip ? (dark ? 0.8 : 0.85) : dark ? 0.2 : 0.6 },
        ]}
      />
      {/* The trip photo is bright, so tone it toward the current theme — a dark
          wash in dark mode, a light one in light mode — so it fits both. */}
      {isTrip && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: Colors[scheme].background, opacity: dark ? 0.55 : 0.15 },
          ]}
        />
      )}
    </>
  );
}
