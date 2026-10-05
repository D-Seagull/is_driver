import { describe, it, expect, jest } from '@jest/globals';

import { withNetworkRetry } from '@/lib/net-retry';

// Minimal axios-error shapes: axios.isAxiosError only checks `isAxiosError === true`.
const transportErr = () => ({ isAxiosError: true, message: 'Network Error' });
const responseErr = (status: number) => ({
  isAxiosError: true,
  message: `HTTP ${status}`,
  response: { status },
});

type Fn = () => Promise<string>;

describe('withNetworkRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = jest.fn<Fn>().mockResolvedValue('ok');
    await expect(withNetworkRetry(fn, 3, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a transport error (no response) then succeeds', async () => {
    const fn = jest
      .fn<Fn>()
      .mockRejectedValueOnce(transportErr())
      .mockRejectedValueOnce(transportErr())
      .mockResolvedValue('ok');
    await expect(withNetworkRetry(fn, 3, 0)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry when the server answered 4xx', async () => {
    const fn = jest.fn<Fn>().mockRejectedValue(responseErr(400));
    await expect(withNetworkRetry(fn, 3, 0)).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry when the server answered 5xx (a real answer, not a lost packet)', async () => {
    const fn = jest.fn<Fn>().mockRejectedValue(responseErr(503));
    await expect(withNetworkRetry(fn, 3, 0)).rejects.toMatchObject({
      response: { status: 503 },
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt limit on persistent transport errors', async () => {
    const fn = jest.fn<Fn>().mockRejectedValue(transportErr());
    await expect(withNetworkRetry(fn, 3, 0)).rejects.toMatchObject({
      isAxiosError: true,
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-axios error', async () => {
    const fn = jest.fn<Fn>().mockRejectedValue(new Error('boom'));
    await expect(withNetworkRetry(fn, 3, 0)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours a custom attempt count', async () => {
    const fn = jest.fn<Fn>().mockRejectedValue(transportErr());
    await expect(withNetworkRetry(fn, 5, 0)).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
