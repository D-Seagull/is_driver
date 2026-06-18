import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { configureApiAuth } from '@/lib/api';
import { AuthUser, fetchMe, requestOtp, verifyOtp } from '@/lib/auth-api';
import { disconnectSocket, getSocket } from '@/lib/socket';

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
      name: 'auth-storage',
      storage: createJSONStorage(() => AsyncStorage),
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
