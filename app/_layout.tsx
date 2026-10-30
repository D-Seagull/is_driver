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
import { initSentry, setSentryUser, wrapRoot } from '@/lib/sentry';
import { useOtaUpdates } from '@/lib/updates';
import { useAuthStore } from '@/store/auth';

// SDK 57 (RN 0.86) deprecates InteractionManager; the warning comes from RN
// internals / libraries, not our code, so there's nothing to refactor here —
// silence it so LogBox stays useful. Remove once the upstream fix lands.
LogBox.ignoreLogs(['InteractionManager has been deprecated']);

// Before anything renders, so errors during startup are reported too.
initSentry();

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

// Crash reports carry only the signed-in user id (lib/sentry); cleared on
// logout or when the session is dropped.
function useSentryUser() {
  const id = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    setSentryUser(id);
  }, [id]);
}

// No `unstable_settings.anchor` here (it came with the Expo template). It
// mounted a hidden (driver) under `index`; index's <Redirect> then replaced
// itself with a SECOND (driver), and both stayed mounted — every overlay,
// socket listener and push handler in that layout ran twice (each trip
// question popped up twice). The root stack holds one route at a time.

function RootLayout() {
  useAppStateRefetch();
  useOtaUpdates();
  useSyncLanguage();
  useSentryUser();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Drives the stable KeyboardAvoidingView used by the chat screens —
            required for react-native-keyboard-controller to work under the
            new architecture + edge-to-edge. */}
        {/* Edge-to-edge (SDK 57 default): without these the Android nav-bar
            inset reads 0 and the chat composer sits on the nav bar. */}
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <NavTheme>
                <Stack>
                  {/* Redirect/splash screen — no header, so the route name
                      "index" never flashes above the spinner before we route
                      into (auth) or (driver). */}
                  <Stack.Screen name="index" options={{ headerShown: false }} />
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

export default wrapRoot(RootLayout);

function NavTheme({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  return (
    <NavThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {children}
    </NavThemeProvider>
  );
}
