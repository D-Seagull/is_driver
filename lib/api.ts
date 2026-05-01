import axios from 'axios';

import { API_URL } from './config';

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

/**
 * Token getter is injected from the auth store at runtime to avoid a circular
 * import (api ← store ← api). See store/auth.ts.
 */
let getToken: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function configureApiAuth(opts: {
  getToken: () => string | null;
  onUnauthorized?: () => void;
}) {
  getToken = opts.getToken;
  if (opts.onUnauthorized) onUnauthorized = opts.onUnauthorized;
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401 && getToken()) {
      onUnauthorized();
    }
    return Promise.reject(error);
  },
);
