import { api } from './api';

export async function registerPushToken(
  token: string,
  platform: 'ios' | 'android' | 'web',
): Promise<void> {
  await api.post('/users/me/push-token', { token, platform });
}

export async function unregisterPushToken(token: string): Promise<void> {
  await api.delete(`/users/me/push-token/${encodeURIComponent(token)}`);
}
