import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavThemeProvider,
} from 'expo-router';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, AppStateStatus, LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { ThemeProvider } from '@/hooks/use-theme';
import { setAppLanguage } from '@/lib/i18n';
import { queryClient } from '@/lib/query';
import { useAuthStore } from '@/store/auth';

// SDK 57 (RN 0.86) deprecates InteractionManager; the warning comes from RN
// internals / libraries, not our code, so there's nothing to refactor here —
// silence it so LogBox stays useful. Remove once the upstream fix lands.
LogBox.ignoreLogs(['InteractionManager has been deprecated']);

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
        {/* Drives the stable KeyboardAvoidingView used by the chat screens —
            required for react-native-keyboard-controller to work under the
            new architecture + edge-to-edge. */}
        <KeyboardProvider>
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
        </KeyboardProvider>
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
