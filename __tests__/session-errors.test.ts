import { describe, expect, it } from '@jest/globals';
import { AxiosError, AxiosHeaders } from 'axios';
import { isSessionRejected } from '../lib/session-errors';

const withStatus = (status: number) =>
  new AxiosError('x', 'ERR', undefined, undefined, {
    status,
    statusText: '',
    data: {},
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

describe('isSessionRejected', () => {
  it('ends the session only when the server says no', () => {
    expect(isSessionRejected(withStatus(401))).toBe(true);
    expect(isSessionRejected(withStatus(403))).toBe(true);
  });

  it('keeps the session when the server could not be reached', () => {
    // offline / timeout: no response at all
    expect(isSessionRejected(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(false);
    expect(isSessionRejected(new AxiosError('timeout', 'ECONNABORTED'))).toBe(false);
    // Render waking up / a deploy
    expect(isSessionRejected(withStatus(502))).toBe(false);
    expect(isSessionRejected(withStatus(503))).toBe(false);
    expect(isSessionRejected(new Error('boom'))).toBe(false);
  });
});
