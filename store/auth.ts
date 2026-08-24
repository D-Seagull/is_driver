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
import {
  AuthUser,
  fetchMe,
  refreshTokens,
  requestOtp,
  revokeRefreshToken,
  verifyOtp,
} from '@/lib/auth-api';
import {
  configureSocketAuth,
  disconnectSocket,
  getSocket,
} from '@/lib/socket';

const STORE_KEY = 'auth-storage';
// SecureStore keys holding ONLY the tokens (kept small — SecureStore caps
// values at ~2KB, and the user profile blob with its signed avatar URL would
// blow past that). Keys allow [A-Za-z0-9._-].
const TOKEN_KEY = 'auth_token';
const REFRESH_KEY = 'auth_refresh';

const isWeb = Platform.OS === 'web';

/**
 * Hybrid persisted storage: the sensitive access + refresh tokens live in the
 * OS keychain / keystore (expo-secure-store), while the non-sensitive user
 * profile stays in AsyncStorage. SecureStore isn't available on web, so there
 * we fall back to AsyncStorage-only (the whole blob, tokens included).
 *
 * Migration: existing installs have the token embedded in the AsyncStorage
 * blob. `getItem` falls back to those legacy values when SecureStore is still
 * empty, so nobody gets logged out; the next `setItem` moves them into
 * SecureStore and nulls them out of the AsyncStorage copy.
 */
const secureAuthStorage: StateStorage = {
  getItem: async (name) => {
    const rest = await AsyncStorage.getItem(name);
    if (isWeb) return rest;
    let token: string | null = null;
    let refreshToken: string | null = null;
    try {
      token = await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      token = null;
    }
    try {
      refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
    } catch {
      refreshToken = null;
    }
    if (!rest) {
      return token || refreshToken
        ? JSON.stringify({
            state: { user: null, token, refreshToken },
            version: 0,
          })
        : null;
    }
    const parsed = JSON.parse(rest);
    // Prefer SecureStore; fall back to the legacy in-blob values (migration).
    parsed.state = {
      ...parsed.state,
      token: token ?? parsed?.state?.token ?? null,
      refreshToken: refreshToken ?? parsed?.state?.refreshToken ?? null,
    };
    return JSON.stringify(parsed);
  },
  setItem: async (name, value) => {
    if (isWeb) {
      await AsyncStorage.setItem(name, value);
      return;
    }
    const parsed = JSON.parse(value);
    const token: string | null = parsed?.state?.token ?? null;
    const refreshToken: string | null = parsed?.state?.refreshToken ?? null;
    const stripped = {
      ...parsed,
      state: { ...parsed.state, token: null, refreshToken: null },
    };
    await Promise.all([
      token
        ? SecureStore.setItemAsync(TOKEN_KEY, token)
        : SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
      refreshToken
        ? SecureStore.setItemAsync(REFRESH_KEY, refreshToken)
        : SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {}),
      AsyncStorage.setItem(name, JSON.stringify(stripped)),
    ]);
  },
  removeItem: async (name) => {
    await Promise.all([
      isWeb
        ? Promise.resolve()
        : SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
      isWeb
        ? Promise.resolve()
        : SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {}),
      AsyncStorage.removeItem(name),
    ]);
  },
};

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  /** Long-lived refresh token — rotated on every silent re-auth. */
  refreshToken: string | null;
  /** True until persist has rehydrated and we've validated the token. */
  isLoading: boolean;
  isHydrated: boolean;

  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  /** Exchange the refresh token for a new access token; null if it failed. */
  refresh: () => Promise<string | null>;
  hydrate: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isLoading: true,
      isHydrated: false,

      requestOtp: async (phone) => {
        await requestOtp(phone);
      },

      verifyOtp: async (phone, code) => {
        const { user, token, refreshToken } = await verifyOtp(phone, code);
        // Drop any stale socket so the new connection picks up the
        // fresh token. Without this getSocket() returns a singleton
        // that joined company-X under nobody, and the backend
        // never broadcasts presence for the new user.
        disconnectSocket();
        // Set token first so the api interceptor injects Authorization on the
        // follow-up /auth/me call below.
        set({ user, token, refreshToken, isLoading: false });
        let finalUser: AuthUser = user;
        try {
          finalUser = await fetchMe();
          set({ user: finalUser });
        } catch {
          // Non-fatal — basic user from verify is enough to proceed.
        }
        // Лише водії можуть заходити в застосунок водія. Якщо це не водій —
        // вийти й показати помилку на екрані коду.
        if (finalUser.role !== 'DRIVER') {
          get().logout();
          throw new Error('DRIVER_ONLY');
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
          // If the access token is expired, the api interceptor transparently
          // refreshes and retries this call — so a success here may already be
          // running on a freshly rotated token.
          const user = await fetchMe();
          // Лише водії можуть користуватись застосунком водія. Персистована сесія
          // менеджера/адміна (напр. з тестів) має вилетіти на логін.
          if (user.role !== 'DRIVER') {
            set({ user: null, token: null, refreshToken: null, isLoading: false });
            return;
          }
          set({ user, isLoading: false });
        } catch {
          set({ user: null, token: null, refreshToken: null, isLoading: false });
        }
      },

      refresh: async () => {
        const rt = get().refreshToken;
        if (!rt) return null;
        try {
          const { user, token, refreshToken } = await refreshTokens(rt);
          // Роль могла змінитись на бекенді — не водій більше не має доступу.
          if (user.role !== 'DRIVER') {
            set({ user: null, token: null, refreshToken: null });
            return null;
          }
          set({ user, token, refreshToken });
          return token;
        } catch {
          // Refresh token rejected (expired / revoked / already rotated) —
          // the session is dead; clear it so the app bounces to login.
          set({ user: null, token: null, refreshToken: null });
          return null;
        }
      },

      setUser: (user) => set({ user }),

      logout: () => {
        const rt = get().refreshToken;
        // Best-effort server-side revoke so the refresh token can't be reused.
        if (rt) void revokeRefreshToken(rt);
        disconnectSocket();
        set({ user: null, token: null, refreshToken: null, isLoading: false });
      },
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => secureAuthStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        // Mark hydrated once persisted state is read; the app then triggers
        // hydrate() to validate the token against the backend.
        state?.hydrate();
        useAuthStore.setState({ isHydrated: true });
      },
    },
  ),
);

// Wire the api client to read tokens from the store, silently refresh on 401,
// and log out only when the refresh itself fails.
configureApiAuth({
  getToken: () => useAuthStore.getState().token,
  refreshAccessToken: () => useAuthStore.getState().refresh(),
  onUnauthorized: () => useAuthStore.getState().logout(),
});

// Feed the socket the current access token on every (re)connect, so a token
// rotated by a silent refresh is used on the next handshake.
configureSocketAuth(() => useAuthStore.getState().token);

// Selectors
export const useUser = () => useAuthStore((s) => s.user);
export const useIsAuth = () => useAuthStore((s) => !!s.token);
export const useAuthHydrated = () => useAuthStore((s) => s.isHydrated);
export const useAuthLoading = () => useAuthStore((s) => s.isLoading);
