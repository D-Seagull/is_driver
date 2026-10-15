import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/**
 * Bottom padding for a scrollable list's content. Android is edge-to-edge
 * (SDK 57 default), so the last rows would sit under the system nav bar —
 * add the bottom inset there. iOS keeps just the base padding.
 */
export function useListBottomPadding(base: number = Spacing.md): number {
  const insets = useSafeAreaInsets();
  return base + (Platform.OS === 'android' ? insets.bottom : 0);
}
