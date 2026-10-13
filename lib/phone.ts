import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import i18n from '@/lib/i18n';

const t = (key: string) => i18n.t(key);

/**
 * Call someone. Android's `tel:` already offers a choice of apps (Viber
 * registers as a dialer there); iOS always goes straight to Phone, so on
 * iPhone we ask first: Phone or Viber.
 */
export function callPhone(phone: string | null | undefined) {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  if (!digits) return;
  if (Platform.OS !== 'ios') {
    dial(digits);
    return;
  }
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: digits,
      options: [t('call.phone'), 'Viber', t('common.cancel')],
      cancelButtonIndex: 2,
    },
    (i) => {
      if (i === 0) dial(digits);
      if (i === 1) openViber(digits);
    },
  );
}

/** Opens the system dialer with the number prefilled (the user still taps "call"). */
function dial(digits: string) {
  void Linking.openURL(`tel:${digits}`).catch(() => {});
}

/**
 * Opens this number in Viber — its contact screen, where the call button is
 * one tap away (Viber has no public "call this number" link). Viber wants
 * the full international number with "+".
 */
function openViber(digits: string) {
  const intl = digits.startsWith('+') ? digits : `+${digits}`;
  Linking.openURL(`viber://contact?number=${encodeURIComponent(intl)}`).catch(
    () => Alert.alert('Viber', t('call.viberMissing')),
  );
}
