import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockPost = jest.fn<(url: string, body: unknown) => Promise<unknown>>();

jest.mock('@/lib/config', () => ({ MOCK_AUTH: false }));
jest.mock('@/lib/api', () => ({ api: { post: (u: string, b: unknown) => mockPost(u, b) } }));

import { fetchOtpChannels, requestOtpVia } from '@/lib/auth-api';

describe('driver sign-in fallback API', () => {
  beforeEach(() => mockPost.mockReset());

  it('returns what the server offers', async () => {
    mockPost.mockResolvedValue({
      data: { channels: ['sms', 'email', 'manager'], emailHint: 'd***@gmail.com' },
    });
    await expect(fetchOtpChannels('+380971234567')).resolves.toEqual({
      channels: ['sms', 'email', 'manager'],
      emailHint: 'd***@gmail.com',
    });
    expect(mockPost).toHaveBeenCalledWith('/auth/driver/otp-channels', {
      phone: '+380971234567',
    });
  });

  it('falls back to SMS + manager when the request fails', async () => {
    mockPost.mockRejectedValue(new Error('offline'));
    await expect(fetchOtpChannels('+380971234567')).resolves.toEqual({
      channels: ['sms', 'manager'],
      emailHint: null,
    });
  });

  it('sends the chosen channel to request-otp', async () => {
    mockPost.mockResolvedValue({ data: { ok: true } });
    await requestOtpVia('+380971234567', 'manager');
    expect(mockPost).toHaveBeenCalledWith('/auth/driver/request-otp', {
      phone: '+380971234567',
      channel: 'manager',
    });
  });
});
