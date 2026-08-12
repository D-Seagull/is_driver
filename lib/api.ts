import axios from 'axios';

import { API_URL } from './config';

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  // 60s: the prod backend runs on Render free tier which sleeps after 15 min
  // idle — the first request wakes it and can take 30-60s. A short timeout
  // makes that first call (usually login) fail with "no connection".
  timeout: 60_000,
});

/**
 * Auth hooks are injected from the auth store at runtime to avoid a circular
 * import (api ← store ← api). See store/auth.ts.
 */
let getToken: () => string | null = () => null;
let onUnauthorized: () => void = () => {};
// Rotate the refresh token → new access token (or null if it failed). Injected
// from the store so this module stays store-agnostic.
let refreshAccessToken: () => Promise<string | null> = async () => null;

export function configureApiAuth(opts: {
  getToken: () => string | null;
  onUnauthorized?: () => void;
  refreshAccessToken?: () => Promise<string | null>;
}) {
  getToken = opts.getToken;
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized;
  if (opts.refreshAccessToken) refreshAccessToken = opts.refreshAccessToken;
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// A single shared refresh promise so N concurrent 401s trigger ONE /auth/refresh
// (rotation is single-use — parallel refreshes would invalidate each other).
let refreshInFlight: Promise<string | null> | null = null;
function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// Don't try to refresh the auth calls themselves (a 401 there is a real
// failure, not an expired access token).
const AUTH_PATHS = ['/auth/refresh', '/auth/logout', '/auth/driver/'];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error?.config;
    const status = error?.response?.status;
    const url: string = original?.url ?? '';
    const isAuthCall = AUTH_PATHS.some((p) => url.includes(p));

    if (status === 401 && getToken() && original && !original._retried && !isAuthCall) {
      original._retried = true;
      let newToken: string | null = null;
      try {
        newToken = await refreshOnce();
      } catch {
        newToken = null;
      }
      if (newToken) {
        // Retry the original request with the fresh access token.
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      // Refresh failed → the session is dead.
      onUnauthorized();
    }
    return Promise.reject(error);
  },
);
