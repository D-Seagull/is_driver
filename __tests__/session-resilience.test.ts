/**
 * Drivers were signed out "when entering a new country": a network switch at
 * the border made the token refresh fail, and the app treated that like an
 * invalid session. These tests pin down what may and may not end a session.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

// ── mocks (names prefixed `mock` so jest.mock factories may use them) ──────
const mockSecure = new Map<string, string>();
const mockSecureFail = { read: false };
const mockSecureDelete = jest.fn<(k: string) => Promise<void>>(async (k) => {
  mockSecure.delete(k);
});
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => {
    if (mockSecureFail.read) throw new Error('keystore locked');
    return mockSecure.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    mockSecure.set(k, v);
  },
  deleteItemAsync: (k: string) => mockSecureDelete(k),
}));
const mockAsync = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockAsync.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockAsync.set(k, v);
    },
    removeItem: async (k: string) => {
      mockAsync.delete(k);
    },
  },
}));
const mockRefreshTokens = jest.fn<(rt: string) => Promise<unknown>>();
const mockFetchMe = jest.fn<() => Promise<unknown>>();
jest.mock('@/lib/auth-api', () => ({
  refreshTokens: (rt: string) => mockRefreshTokens(rt),
  fetchMe: () => mockFetchMe(),
  revokeRefreshToken: async () => {},
  requestOtp: async () => {},
  requestOtpVia: async () => {},
  verifyOtp: async () => ({}),
}));
// Stored on globalThis: the store registers it while being imported, before
// this file's own `let`s are initialised.
type Reauth = () => Promise<boolean>;
const reauth = () => (globalThis as { __reauth?: Reauth }).__reauth;
jest.mock('@/lib/socket', () => ({
  configureSocketAuth: () => {},
  configureSocketReauth: (fn: () => Promise<boolean>) => {
    (globalThis as { __reauth?: () => Promise<boolean> }).__reauth = fn;
  },
  disconnectSocket: () => {},
  getSocket: () => ({}),
}));
// No retry delays in tests.
jest.mock('@/lib/net-retry', () => {
  const real = jest.requireActual<typeof import('@/lib/net-retry')>('@/lib/net-retry');
  return {
    ...real,
    withSessionRetry: <T,>(fn: () => Promise<T>, isRejected: (e: unknown) => boolean) =>
      real.withSessionRetry(fn, isRejected, 3, 0),
  };
});
jest.mock('@/lib/i18n', () => ({ __esModule: true, default: { language: 'uk', t: (k: string) => k } }));

import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { SessionUnreachableError } from '@/lib/session-errors';

const res = (status: number, data: unknown) =>
  new AxiosError('x', 'ERR', undefined, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
const backend401 = () =>
  res(401, { statusCode: 401, timestamp: 't', path: '/auth/refresh', message: 'no' });
const offline = () => new AxiosError('Network Error', 'ERR_NETWORK');
const driver = { id: 'd1', role: 'DRIVER', firstName: 'Ann' };
const signedIn = () =>
  useAuthStore.setState({ user: driver as never, token: 'old-access', refreshToken: 'rt-1' });

beforeEach(() => {
  jest.clearAllMocks();
  mockSecureFail.read = false;
  signedIn();
});

describe('token refresh', () => {
  it('offline: keeps the session and says "unreachable" (retried 3×)', async () => {
    mockRefreshTokens.mockRejectedValue(offline());
    await expect(useAuthStore.getState().refresh()).rejects.toBeInstanceOf(
      SessionUnreachableError,
    );
    expect(mockRefreshTokens).toHaveBeenCalledTimes(3);
    expect(useAuthStore.getState().refreshToken).toBe('rt-1');
    expect(useAuthStore.getState().token).toBe('old-access');
  });

  it('a Cloudflare / captive-portal 403 page does not sign out', async () => {
    mockRefreshTokens.mockRejectedValue(res(403, '<html>Just a moment...</html>'));
    await expect(useAuthStore.getState().refresh()).rejects.toBeInstanceOf(
      SessionUnreachableError,
    );
    expect(useAuthStore.getState().refreshToken).toBe('rt-1');
  });

  it('recovers when the network comes back mid-retry', async () => {
    mockRefreshTokens
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ token: 'new-access', refreshToken: 'rt-2', user: driver });
    await expect(useAuthStore.getState().refresh()).resolves.toBe('new-access');
    expect(useAuthStore.getState().refreshToken).toBe('rt-2');
  });

  it('our backend rejecting the refresh token signs out — at once, no retries', async () => {
    mockRefreshTokens.mockRejectedValue(backend401());
    await expect(useAuthStore.getState().refresh()).resolves.toBeNull();
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('parallel callers share ONE refresh (single-use token rotated once)', async () => {
    let release!: (v: unknown) => void;
    mockRefreshTokens.mockReturnValue(new Promise((r) => (release = r)));
    const calls = [1, 2, 3].map(() => useAuthStore.getState().refresh());
    release({ token: 'new-access', refreshToken: 'rt-2', user: driver });
    await expect(Promise.all(calls)).resolves.toEqual(['new-access', 'new-access', 'new-access']);
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
  });
});

describe('api client on 401', () => {
  const adapterReturning401 = jest.fn(async (config: InternalAxiosRequestConfig) => {
    throw new AxiosError('401', 'ERR', config, undefined, {
      status: 401,
      statusText: '',
      data: { statusCode: 401, timestamp: 't', path: '/auth/me', message: 'no' },
      headers: {},
      config,
    });
  });
  beforeEach(() => {
    adapterReturning401.mockClear();
    api.defaults.adapter = adapterReturning401 as never;
  });

  it('refresh unreachable → rejects with "unreachable", NOT the 401 (no sign-out at launch)', async () => {
    mockRefreshTokens.mockRejectedValue(offline());
    const err = await api.get('/auth/me-like').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionUnreachableError);
    expect(useAuthStore.getState().refreshToken).toBe('rt-1');
  });

  it('several requests hitting 401 together trigger one refresh', async () => {
    let release!: (v: unknown) => void;
    mockRefreshTokens.mockReturnValue(new Promise((r) => (release = r)));
    let n = 0;
    api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      // First pass: 401 for everyone; after the refresh, the retries succeed.
      if (config.headers.Authorization === 'Bearer new-access') {
        return { data: { ok: ++n }, status: 200, statusText: '', headers: {}, config };
      }
      return adapterReturning401(config);
    }) as never;
    const calls = [api.get('/a'), api.get('/b'), api.get('/c')];
    await new Promise((r) => setTimeout(r, 0));
    release({ token: 'new-access', refreshToken: 'rt-2', user: driver });
    const results = await Promise.all(calls);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
  });

  it('launch check (hydrate) keeps the session when the refresh is unreachable', async () => {
    mockRefreshTokens.mockRejectedValue(offline());
    mockFetchMe.mockImplementation(() => api.get('/auth/me'));
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().token).toBe('old-access');
    expect(useAuthStore.getState().refreshToken).toBe('rt-1');
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});

describe('socket dropped by the server (handshake token rejected)', () => {
  it('forces a refresh and asks to reconnect', async () => {
    mockRefreshTokens.mockResolvedValue({ token: 'new-access', refreshToken: 'rt-2', user: driver });
    expect(reauth()).toBeDefined();
    await expect(reauth()!()).resolves.toBe(true);
    expect(mockRefreshTokens).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().token).toBe('new-access');
  });

  it('offline: keeps the session and still asks to reconnect later', async () => {
    mockRefreshTokens.mockRejectedValue(offline());
    await expect(reauth()!()).resolves.toBe(true);
    expect(useAuthStore.getState().refreshToken).toBe('rt-1');
  });

  it('session really gone → no reconnect', async () => {
    mockRefreshTokens.mockRejectedValue(backend401());
    await expect(reauth()!()).resolves.toBe(false);
  });
});

describe('keychain that could not be read', () => {
  it('does not turn a failed read into a permanent sign-out', async () => {
    mockSecure.set('auth_token', 'saved-access');
    mockSecure.set('auth_refresh', 'saved-rt');
    mockSecureFail.read = true;
    await useAuthStore.persist.rehydrate();
    // The state could not get the tokens, but writing that back must not
    // delete them from the keychain.
    useAuthStore.setState({ isLoading: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSecureDelete).not.toHaveBeenCalled();
    expect(mockSecure.get('auth_refresh')).toBe('saved-rt');
  });

  it('a deliberate sign-out still deletes the tokens', async () => {
    mockSecure.set('auth_token', 'saved-access');
    mockSecure.set('auth_refresh', 'saved-rt');
    mockSecureFail.read = true;
    await useAuthStore.persist.rehydrate();
    useAuthStore.getState().logout();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSecureDelete).toHaveBeenCalledWith('auth_refresh');
  });
});

// Keep the import used even if a test above is skipped.
void axios;
