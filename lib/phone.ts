import { Linking } from 'react-native';

/** Opens the system dialer with the number prefilled (the user still taps "call"). */
export function callPhone(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  if (!digits) return;
  void Linking.openURL(`tel:${digits}`).catch(() => {});
}
