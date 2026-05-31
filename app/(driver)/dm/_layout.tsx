import { Stack } from 'expo-router';

/**
 * DM stack — `[userId]` is rendered with its own custom header (back button
 * + peer name) instead of the drawer's header, so the chat feels native
 * (slide-in animation, swipe-back gesture).
 */
export default function DmLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
