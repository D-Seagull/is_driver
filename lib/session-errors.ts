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
 * True only when the server actually answered "no" to the session (401 / 403).
 * No response at all, a timeout or a 5xx says nothing about the tokens and
 * must not log the user out.
 */
export function isSessionRejected(err: unknown): boolean {
  const status = isAxiosError(err) ? err.response?.status : undefined;
  return status === 401 || status === 403;
}
