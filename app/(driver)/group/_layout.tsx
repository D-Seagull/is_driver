import { Stack } from 'expo-router';

/**
 * Group-chat stack — `[groupId]` renders its own custom header (back button +
 * group name) instead of the drawer's, matching the DM stack so the chat
 * feels native (slide-in, swipe-back).
 */
export default function GroupLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
