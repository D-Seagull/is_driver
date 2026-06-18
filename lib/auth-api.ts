import { api } from './api';
import { MOCK_AUTH } from './config';

export interface DriverTruckSummary {
  id: string;
  plate: string;
  status: string;
}

export interface ManagerSummary {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  avatar: string | null;
}

export interface AuthUser {
  id: string;
  role: 'DRIVER' | 'MANAGER' | 'TEAMLEAD' | 'ADMIN';
  companyId: string | null;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email?: string | null;
  avatar?: string | null;
  timezone?: string | null;
  currentTruck?: DriverTruckSummary | null;
  manager?: ManagerSummary | null;
}

export async function setMyTimezone(timezone: string): Promise<void> {
  await api.patch('/users/me/timezone', { timezone });
}

/**
 * Upload an avatar from the device. The picker gives us a local file URI; we
 * wrap it in FormData with whatever filename / mime we can detect and POST
 * it to `/users/avatar` (same endpoint the web frontend uses).
 *
 * Returns the latest AuthUser so the caller can refresh the store without a
 * follow-up /auth/me round trip.
 */
export async function uploadAvatar(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<AuthUser> {
  const form = new FormData();
  // RN/Expo FormData accepts the { uri, name, type } shape — TS doesn't
  // model this on the web FormData type so we cast.
  form.append('file', {
    uri: asset.uri,
    name: asset.fileName || 'avatar.jpg',
    type: asset.mimeType || 'image/jpeg',
  } as unknown as Blob);
  await api.post('/users/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}

export async function deleteAvatar(): Promise<AuthUser> {
  await api.delete('/users/avatar');
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}

const FAKE_DELAY = 600;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Step 1 — driver enters the phone number, server sends an SMS code.
 * In MOCK_AUTH mode we just resolve after a small delay so the UI behaves
 * the same way it will once Twilio is wired up on the backend.
 */
export async function requestOtp(phone: string): Promise<void> {
  if (MOCK_AUTH) {
    await wait(FAKE_DELAY);
    return;
  }
  try {
    console.log('[auth-api] requestOtp →', { phone });
    const res = await api.post('/auth/driver/request-otp', { phone });
    console.log('[auth-api] requestOtp ✓', res.status, res.data);
  } catch (err) {
    console.warn('[auth-api] requestOtp ✗', err);
    throw err;
  }
}

/**
 * Step 2 — driver enters the 6-digit code. Returns user + JWT.
 * Mock accepts code "123456" (or any 6-digit code while MOCK_AUTH is true)
 * and synthesizes a fake driver identity.
 */
export async function verifyOtp(phone: string, code: string): Promise<AuthResult> {
  if (MOCK_AUTH) {
    await wait(FAKE_DELAY);
    if (!/^\d{6}$/.test(code)) {
      throw new Error('Code must be 6 digits.');
    }
    return {
      token: `mock.jwt.${Date.now()}`,
      user: {
        id: 'mock-driver-id',
        role: 'DRIVER',
        companyId: 'mock-company',
        firstName: 'Volodymyr',
        lastName: 'Kovalenko',
        phone,
        currentTruck: { id: 'mock-truck-id', plate: 'TRK-1042', status: 'AVAILABLE' },
        manager: {
          id: 'mock-manager-id',
          firstName: 'Anna',
          lastName: 'Petrenko',
          phone: '+380501112233',
          avatar: null,
        },
      },
    };
  }
  try {
    console.log('[auth-api] verifyOtp →', { phone, code });
    // Backend returns { access_token, user }. We expose the token as `token`
    // throughout the app for symmetry with the auth store / api interceptor.
    const { data } = await api.post<{ access_token: string; user: AuthUser }>(
      '/auth/driver/verify-otp',
      { phone, code },
    );
    console.log('[auth-api] verifyOtp ✓', { userId: data.user?.id });
    return { token: data.access_token, user: data.user };
  } catch (err) {
    console.warn('[auth-api] verifyOtp ✗', err);
    throw err;
  }
}

/**
 * Validate an existing token on app launch.
 */
export async function fetchMe(): Promise<AuthUser> {
  if (MOCK_AUTH) {
    return {
      id: 'mock-driver-id',
      role: 'DRIVER',
      companyId: 'mock-company',
      firstName: 'Volodymyr',
      lastName: 'Kovalenko',
      phone: '+380501234567',
      currentTruck: { id: 'mock-truck-id', plate: 'TRK-1042', status: 'AVAILABLE' },
      manager: {
        id: 'mock-manager-id',
        firstName: 'Anna',
        lastName: 'Petrenko',
        phone: '+380501112233',
        avatar: null,
      },
    };
  }
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}
