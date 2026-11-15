import { isAxiosError } from 'axios';

/**
 * The refresh couldn't reach the server (offline, in a tunnel, Render waking
 * up, a deploy, a 5xx). The tokens may be perfectly valid — keep the session,
 * retry later.
 */
export class SessionUnreachableError extends Error {
  constructor() {
    super('session-server-unreachable');
    this.name = 'SessionUnreachableError';
  }
}

/**
 * True only when OUR backend actually answered "no" to the session (401 /
 * 403 in its own JSON error shape `{ statusCode, path, message }`).
 *
 * No response at all, a timeout, a 5xx or a 429 says nothing about the
 * tokens. Neither does a 401 / 403 from something in between — Cloudflare's
 * bot check for an IP from a new country, a hotel / roaming captive portal,
 * a carrier proxy: those answer with an HTML page, not our JSON. None of
 * these may log the driver out.
 */
export function isSessionRejected(err: unknown): boolean {
  if (!isAxiosError(err) || !err.response) return false;
  const { status, data } = err.response;
  if (status !== 401 && status !== 403) return false;
  return isBackendError(data, status);
}

/** The JSON body our backend's exception filter sends. */
function isBackendError(data: unknown, status: number): boolean {
  if (!data || typeof data !== 'object') return false;
  const body = data as { statusCode?: unknown; path?: unknown };
  return body.statusCode === status && typeof body.path === 'string';
}
