import { Image, StyleSheet } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

// Isometric logistics-map wallpaper for the trip chat. Fixed (doesn't scroll)
// behind the messages. The artwork is light, so it's shown near-solid in light
// mode and heavily dimmed in dark mode to keep contrast. Mirrors is-manager.
const CHAT_BG = require('../assets/images/chat-bg.png');

export function ChatBackground() {
  const scheme = useColorScheme() ?? 'light';
  return (
    <Image
      source={CHAT_BG}
      resizeMode="cover"
      style={[StyleSheet.absoluteFill, { opacity: scheme === 'dark' ? 0.2 : 0.6 }]}
    />
  );
}
