import axios from 'axios';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Retry a call ONLY on transport-level failures — no HTTP response arrived
 * (flaky roaming / satellite link at sea, dropped packet, or a Render cold
 * start that times out on the first wake). A response with any status (400,
 * 401, 5xx) is a real server answer and is never retried. Drivers on bad
 * links were seeing "no connection" on a single lost packet; a couple of
 * quiet retries turns most of those into a successful login.
 *
 * `baseDelayMs` is the first back-off (then 2×, 3×, …); tests pass 0.
 */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 800,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const isTransport = axios.isAxiosError(err) && !err.response;
      if (!isTransport || i === attempts - 1) throw err;
      lastErr = err;
      // 0.8s, 1.6s — short enough not to feel stuck, long enough to ride out
      // a brief signal drop.
      if (baseDelayMs > 0) await wait(baseDelayMs * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Retry a session call (the token refresh) on anything that is NOT a clear
 * "your session is invalid" from our backend: no response, a timeout, a 5xx,
 * a 429, an HTML page from a proxy / captive portal. Crossing a border, the
 * phone switches networks and the first tries often fail — a few quiet
 * retries (1 s, 2 s, 4 s) ride that out instead of failing the request.
 * `isRejected` decides what is final; tests pass `baseDelayMs` 0.
 */
export async function withSessionRetry<T>(
  fn: () => Promise<T>,
  isRejected: (err: unknown) => boolean,
  attempts = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isRejected(err) || i === attempts - 1) throw err;
      lastErr = err;
      if (baseDelayMs > 0) await wait(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}
