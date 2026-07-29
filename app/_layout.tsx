import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from '@react-navigation/native';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeProvider } from '@/hooks/use-theme';
import { setAppLanguage } from '@/lib/i18n';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';

// Tell React Query when the app returns to foreground from background.
// We track the PREVIOUS state so we only trigger on a real background→active
// transition, not on every 'active' event iOS fires (keyboard, notifications…).
function useAppStateRefetch() {
  useEffect(() => {
    let prevState = AppState.currentState;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (
        (prevState === 'background' || prevState === 'inactive') &&
        next === 'active'
      ) {
        focusManager.setFocused(true);
      }
      prevState = next;
    });
    return () => sub.remove();
  }, []);
}

// Keep the app UI language in sync with the user's saved language (set from
// the Settings picker). Falls back to the device locale / EN via lib/i18n.
function useSyncLanguage() {
  const lang = useAuthStore((s) => s.user?.language);
  useEffect(() => {
    setAppLanguage(lang);
  }, [lang]);
}

export const unstable_settings = {
  anchor: '(driver)',
};

export default function RootLayout() {
  useAppStateRefetch();
  useSyncLanguage();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <NavTheme>
              <Stack>
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="(driver)" options={{ headerShown: false }} />
              </Stack>
              <StatusBar style="auto" />
            </NavTheme>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function NavTheme({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  return (
    <NavThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {children}
    </NavThemeProvider>
  );
}
