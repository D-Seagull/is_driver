import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPost = jest.fn<(url: string, body: unknown) => Promise<unknown>>();

// This "build": SMS + manager on, WhatsApp off, Telegram on.
jest.mock('@/lib/config', () => ({
  MOCK_AUTH: false,
  LOGIN_METHODS: { sms: true, whatsapp: false, telegram: true, manager: true },
}));
jest.mock('@/lib/api', () => ({ api: { post: (u: string, b: unknown) => mockPost(u, b) } }));

import { appLoginMethods, fetchOtpChannels, requestOtpVia } from '@/lib/auth-api';

describe('driver sign-in methods', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('app flags give the local list, manager last', () => {
    expect(appLoginMethods()).toEqual(['sms', 'telegram', 'manager']);
  });

  it('offers only what is on both here and on the server', async () => {
    mockPost.mockResolvedValue({ data: { channels: ['sms', 'whatsapp', 'manager'] } });
    await expect(fetchOtpChannels('+380971234567')).resolves.toEqual({
      channels: ['sms', 'manager'],
    });
    expect(mockPost).toHaveBeenCalledWith('/auth/driver/otp-channels', {
      phone: '+380971234567',
    });
  });

  it('a method switched off on the server disappears', async () => {
    mockPost.mockResolvedValue({ data: { channels: ['telegram'] } });
    await expect(fetchOtpChannels('+380971234567')).resolves.toEqual({
      channels: ['telegram'],
    });
  });

  it("falls back to the app's own list when the request fails", async () => {
    mockPost.mockRejectedValue(new Error('offline'));
    await expect(fetchOtpChannels('+380971234567')).resolves.toEqual({
      channels: ['sms', 'telegram', 'manager'],
    });
  });

  it('sends the chosen method to request-otp', async () => {
    mockPost.mockResolvedValue({ data: { ok: true } });
    await requestOtpVia('+380971234567', 'manager');
    expect(mockPost).toHaveBeenCalledWith('/auth/driver/request-otp', {
      phone: '+380971234567',
      channel: 'manager',
    });
  });
});
