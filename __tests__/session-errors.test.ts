import { describe, expect, it } from '@jest/globals';
import { AxiosError, AxiosHeaders } from 'axios';
import { isSessionRejected } from '../lib/session-errors';

const withResponse = (status: number, data: unknown) =>
  new AxiosError('x', 'ERR', undefined, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
// Our backend's exception filter shape.
const backend = (status: number) =>
  withResponse(status, {
    statusCode: status,
    timestamp: '2026-11-15T10:00:00.000Z',
    path: '/auth/refresh',
    message: 'Немає доступу',
  });

describe('isSessionRejected', () => {
  it('ends the session only when OUR backend says no', () => {
    expect(isSessionRejected(backend(401))).toBe(true);
    expect(isSessionRejected(backend(403))).toBe(true);
  });

  it('keeps the session when the server could not be reached', () => {
    // offline / timeout: no response at all
    expect(isSessionRejected(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(false);
    expect(isSessionRejected(new AxiosError('timeout', 'ECONNABORTED'))).toBe(false);
    // Render waking up / a deploy / rate limit
    expect(isSessionRejected(backend(502))).toBe(false);
    expect(isSessionRejected(backend(503))).toBe(false);
    expect(isSessionRejected(backend(429))).toBe(false);
    expect(isSessionRejected(new Error('boom'))).toBe(false);
  });

  it('keeps the session on a 401/403 from something in between', () => {
    // Cloudflare bot check for an IP from a new country
    expect(
      isSessionRejected(withResponse(403, '<!DOCTYPE html><title>Just a moment...</title>')),
    ).toBe(false);
    // hotel / roaming captive portal
    expect(isSessionRejected(withResponse(401, '<html>Please log in to Wi-Fi</html>'))).toBe(false);
    // some other JSON, not ours
    expect(isSessionRejected(withResponse(403, { error: 'forbidden' }))).toBe(false);
    expect(isSessionRejected(withResponse(401, {}))).toBe(false);
  });
});
