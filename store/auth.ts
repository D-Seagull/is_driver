import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from 'zustand/middleware';

import { configureApiAuth } from '@/lib/api';
import { AuthUser, fetchMe, requestOtp, verifyOtp } from '@/lib/auth-api';
import { disconnectSocket, getSocket } from '@/lib/socket';

const STORE_KEY = 'auth-storage';
// SecureStore key holding ONLY the JWT (kept small — SecureStore caps values
// at ~2KB, and the user profile blob with its signed avatar URL would blow
// past that). Keys allow [A-Za-z0-9._-].
const TOKEN_KEY = 'auth_token';

const isWeb = Platform.OS === 'web';

/**
 * Hybrid persisted storage: the sensitive JWT lives in the OS keychain /
 * keystore (expo-secure-store), while the non-sensitive user profile stays in
 * AsyncStorage. SecureStore isn't available on web, so there we fall back to
 * AsyncStorage-only (the whole blob, token included).
 *
 * Migration: existing installs have the token embedded in the AsyncStorage
 * blob. `getItem` falls back to that legacy token when SecureStore is still
 * empty, so nobody gets logged out; the next `setItem` moves it into
 * SecureStore and nulls it out of the AsyncStorage copy.
 */
const secureAuthStorage: StateStorage = {
  getItem: async (name) => {
    const rest = await AsyncStorage.getItem(name);
    if (isWeb) return rest;
    let token: string | null = null;
    try {
      token = await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!rest) {
      return token
        ? JSON.stringify({ state: { user: null, token }, version: 0 })
        : null;
    }
    const parsed = JSON.parse(rest);
    // Prefer SecureStore; fall back to the legacy in-blob token (migration).
    const effectiveToken = token ?? parsed?.state?.token ?? null;
    parsed.state = { ...parsed.state, token: effectiveToken };
    return JSON.stringify(parsed);
  },
  setItem: async (name, value) => {
    if (isWeb) {
      await AsyncStorage.setItem(name, value);
      return;
    }
    const parsed = JSON.parse(value);
    const token: string | null = parsed?.state?.token ?? null;
    const stripped = { ...parsed, state: { ...parsed.state, token: null } };
    await Promise.all([
      token
        ? SecureStore.setItemAsync(TOKEN_KEY, token)
        : SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
      AsyncStorage.setItem(name, JSON.stringify(stripped)),
    ]);
  },
  removeItem: async (name) => {
    await Promise.all([
      isWeb
        ? Promise.resolve()
        : SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
      AsyncStorage.removeItem(name),
    ]);
  },
};

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  /** True until persist has rehydrated and we've validated the token. */
  isLoading: boolean;
  isHydrated: boolean;

  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  hydrate: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isLoading: true,
      isHydrated: false,

      requestOtp: async (phone) => {
        await requestOtp(phone);
      },

      verifyOtp: async (phone, code) => {
        const { user, token } = await verifyOtp(phone, code);
        // Drop any stale socket so the new connection picks up the
        // fresh token. Without this getSocket() returns a singleton
        // that joined company-X under nobody, and the backend
        // never broadcasts presence for the new user.
        disconnectSocket();
        // Set token first so the api interceptor injects Authorization on the
        // follow-up /auth/me call below.
        set({ user, token, isLoading: false });
        try {
          const enriched = await fetchMe();
          set({ user: enriched });
        } catch {
          // Non-fatal — basic user from verify is enough to proceed.
        }
        // Open socket connection now that we have a token
        getSocket(get().token ?? undefined);
      },

      hydrate: async () => {
        const { token } = get();
        if (!token) {
          set({ isLoading: false });
          return;
        }
        try {
          const user = await fetchMe();
          set({ user, isLoading: false });
        } catch {
          set({ user: null, token: null, isLoading: false });
        }
      },

      setUser: (user) => set({ user }),

      logout: () => {
        disconnectSocket();
        set({ user: null, token: null, isLoading: false });
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => secureAuthStorage),
      partialize: (state) => ({ user: state.user, token: state.token }),
      onRehydrateStorage: () => (state) => {
        // Mark hydrated once persisted state is read; the app then triggers
        // hydrate() to validate the token against the backend.
        state?.hydrate();
        useAuthStore.setState({ isHydrated: true });
      },
    },
  ),
);

// Wire the api client to read tokens from the store and react to 401s.
configureApiAuth({
  getToken: () => useAuthStore.getState().token,
  onUnauthorized: () => useAuthStore.getState().logout(),
});

// Selectors
export const useUser = () => useAuthStore((s) => s.user);
export const useIsAuth = () => useAuthStore((s) => !!s.token);
export const useAuthHydrated = () => useAuthStore((s) => s.isHydrated);
export const useAuthLoading = () => useAuthStore((s) => s.isLoading);
