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
import { isSessionRejected, SessionUnreachableError } from '@/lib/session-errors';
import { withSessionRetry } from '@/lib/net-retry';
import {
  AuthUser,
  fetchMe,
  refreshTokens,
  requestOtp,
  requestOtpVia,
  OtpChannel,
  revokeRefreshToken,
  verifyOtp,
} from '@/lib/auth-api';
import {
  configureSocketAuth,
  configureSocketReauth,
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

// Set when the keychain could not be READ (it threw — e.g. still locked, a
// keystore hiccup). The tokens in it may be perfectly fine, so until we have
// read or written them again, a `null` in the state must not be written
// back as "delete the tokens" — that turned one failed read into a
// permanent logout. Cleared on the next successful read / token write, and
// overridden by an intentional sign-out (see clearSessionOnPurpose).
let keychainUnreadable = false;
// The next persist write is a deliberate sign-out: delete the tokens even if
// the keychain was unreadable.
let clearOnPurpose = false;

async function readSecure(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // One quiet retry: a keystore that was busy a moment ago usually answers.
    await new Promise((r) => setTimeout(r, 300));
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      keychainUnreadable = true;
      return null;
    }
  }
}

// Refresh tokens are single-use (rotated on every refresh). If two callers race
// (e.g. the socket reconnect handshake AND an api 401 retry, both firing after
// a 15-min idle), the second would send an already-rotated token and kill the
// session. Dedupe: everyone awaits the same in-flight refresh.
let refreshInFlight: Promise<string | null> | null = null;

// Decode the JWT `exp` (seconds) to tell if the access token is still good.
// Treats an undecodable token as stale so we refresh rather than send garbage.
function accessTokenFresh(token: string | null): boolean {
  if (!token) return false;
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const json = globalThis.atob(b64 + pad);
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    // Fresh only if it survives the next 60s — leaves room for the handshake.
    return !!exp && exp * 1000 - Date.now() > 60_000;
  } catch {
    return false;
  }
}

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
    keychainUnreadable = false;
    const token = await readSecure(TOKEN_KEY);
    const refreshToken = await readSecure(REFRESH_KEY);
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
    // A `null` token is a real sign-out only if we know what the keychain
    // holds (it was readable) or the sign-out is deliberate.
    const mayDelete = !keychainUnreadable || clearOnPurpose;
    clearOnPurpose = false;
    if (token || refreshToken) keychainUnreadable = false;
    await Promise.all([
      token
        ? SecureStore.setItemAsync(TOKEN_KEY, token)
        : mayDelete
          ? SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {})
          : Promise.resolve(),
      refreshToken
        ? SecureStore.setItemAsync(REFRESH_KEY, refreshToken)
        : mayDelete
          ? SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => {})
          : Promise.resolve(),
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

/** Mark the next persisted write as a deliberate sign-out (see setItem). */
function clearSessionOnPurpose() {
  clearOnPurpose = true;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  /** Long-lived refresh token — rotated on every silent re-auth. */
  refreshToken: string | null;
  /** True until persist has rehydrated and we've validated the token. */
  isLoading: boolean;
  isHydrated: boolean;

  requestOtp: (phone: string) => Promise<void>;
  /** SMS didn't come — send a code another way (email, manager, …). */
  requestOtpVia: (phone: string, channel: OtpChannel) => Promise<void>;
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

      requestOtpVia: async (phone, channel) => {
        await requestOtpVia(phone, channel);
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
            clearSessionOnPurpose();
            set({ user: null, token: null, refreshToken: null, isLoading: false });
            return;
          }
          set({ user, isLoading: false });
        } catch (err) {
          // No signal / server waking up: keep the saved session and open the
          // app with it — requests retry once the network is back. Only the
          // server rejecting the session (401 / 403) sends the user to login.
          if (isSessionRejected(err)) {
            clearSessionOnPurpose();
            set({ user: null, token: null, refreshToken: null, isLoading: false });
          } else {
            set({ isLoading: false });
          }
        }
      },

      refresh: async () => {
        // Coalesce concurrent refreshes onto one in-flight request so the
        // single-use refresh token is rotated exactly once.
        if (refreshInFlight) return refreshInFlight;
        refreshInFlight = (async () => {
          const rt = get().refreshToken;
          // No refresh token in memory while the keychain couldn't be read:
          // that's "don't know", not "signed out" — keep the session.
          if (!rt) {
            if (keychainUnreadable) throw new SessionUnreachableError();
            return null;
          }
          try {
            // Retries no-response / timeout / 5xx / 429 / proxy pages (1 s,
            // 2 s, 4 s) — a network switch at a border fails the first tries.
            // A retry after a lost response reuses the same token; the server
            // accepts that (grace window / unused-successor rule).
            const { user, token, refreshToken } = await withSessionRetry(
              () => refreshTokens(rt),
              isSessionRejected,
            );
            // Роль могла змінитись на бекенді — не водій більше не має доступу.
            if (user.role !== 'DRIVER') {
              clearSessionOnPurpose();
              set({ user: null, token: null, refreshToken: null });
              return null;
            }
            // Merge, don't replace — see setUser.
            set({ user: { ...(get().user ?? {}), ...user }, token, refreshToken });
            return token;
          } catch (err) {
            // Server unreachable — the refresh token is still good: keep the
            // session and let the caller fail just this request.
            if (!isSessionRejected(err)) throw new SessionUnreachableError();
            // Our backend rejected the refresh token (expired / revoked) — the
            // session is dead; clear it so the app bounces to login.
            clearSessionOnPurpose();
            set({ user: null, token: null, refreshToken: null });
            return null;
          }
        })();
        try {
          return await refreshInFlight;
        } finally {
          refreshInFlight = null;
        }
      },

      // Profile updates MERGE into the stored user, never replace it: a
      // response that lacks a field (an older backend, a partial echo) must
      // not wipe it — that is how the avatar vanished after token refreshes.
      // Fields really cleared arrive as `null` and still overwrite.
      setUser: (user) =>
        set((s) => ({ user: s.user ? { ...s.user, ...user } : user })),

      logout: () => {
        const rt = get().refreshToken;
        // Best-effort server-side revoke so the refresh token can't be reused.
        if (rt) void revokeRefreshToken(rt);
        disconnectSocket();
        clearSessionOnPurpose();
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
  isCompanyActive: () => useAuthStore.getState().user?.company?.isActive !== false,
});

// Feed the socket the current access token on every (re)connect, so a token
// rotated by a silent refresh is used on the next handshake.
configureSocketAuth(async () => {
  const s = useAuthStore.getState();
  if (accessTokenFresh(s.token)) return s.token;
  if (!s.refreshToken) return s.token;
  // Offline: hand over what we have; the socket can't connect anyway and
  // asks again on the next attempt.
  await s.refresh().catch(() => undefined);
  return useAuthStore.getState().token;
});

// The server dropped the socket (handshake token rejected — its clock is the
// one that counts): refresh regardless of what the phone's clock thinks, then
// let the socket reconnect. No session left → no reconnect.
configureSocketReauth(async () => {
  if (!useAuthStore.getState().refreshToken) return false;
  try {
    return !!(await useAuthStore.getState().refresh());
  } catch {
    return true; // server unreachable — keep trying, the session is intact
  }
});

// Selectors
export const useUser = () => useAuthStore((s) => s.user);
export const useIsAuth = () => useAuthStore((s) => !!s.token);
export const useAuthHydrated = () => useAuthStore((s) => s.isHydrated);
export const useAuthLoading = () => useAuthStore((s) => s.isLoading);
export const useIsCompanyActive = () =>
  useAuthStore((s) => s.user?.company?.isActive !== false);
