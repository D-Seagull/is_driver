import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/**
 * Bottom padding for a scrollable list's content. Android is edge-to-edge
 * (SDK 57 default), so the last rows would sit under the system nav bar —
 * add the bottom inset there. iOS keeps just the base padding, unless `ios`
 * asks for the home-indicator inset too (screens that always had it).
 *
 * Prefer InsetFlatList / InsetScrollView (components/inset-list), which apply
 * this for you — use the hook directly only where those can't go.
 */
export function useListBottomPadding(
  base: number = Spacing.md,
  opts?: { ios?: boolean },
): number {
  const insets = useSafeAreaInsets();
  const withInset = Platform.OS === 'android' || opts?.ios === true;
  return base + (withInset ? insets.bottom : 0);
}
