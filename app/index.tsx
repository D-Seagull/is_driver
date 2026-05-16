import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuthStore } from '@/store/auth';

export default function Index() {
  const c = Colors[useColorScheme() ?? 'light'];
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  // Wait until persist has loaded and we've validated any stored token.
  if (!isHydrated || isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!token) {
    return <Redirect href="/(auth)/phone" />;
  }

  // Has a truck → drop into Trip chat. No truck yet → straight to manager chat.
  return (
    <Redirect href={user?.currentTruck ? '/(driver)/trip' : '/(driver)/chat'} />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
