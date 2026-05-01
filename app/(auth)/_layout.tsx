import { Redirect, Stack } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/store/auth';

export default function AuthLayout() {
  const c = Colors[useColorScheme() ?? 'light'];
  const token = useAuthStore((s) => s.token);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  // If a session is already restored, skip auth screens.
  if (isHydrated && token) {
    return <Redirect href="/(driver)/trip" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: c.background },
      }}
    />
  );
}
