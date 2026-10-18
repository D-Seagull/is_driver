import { Platform } from 'react-native';

import { Spacing } from '@/constants/theme';

/**
 * A little air above the Android nav bar for anything pinned to the bottom
 * edge (composers, bottom bars, sheets). The bar's own inset sits under the
 * system's (3-button) nav-bar scrim, so content padded by exactly the inset
 * looked glued to the nav bar.
 */
export const NAV_BAR_AIR = Spacing.sm;

/**
 * Bottom padding for a bar or sheet pinned to the bottom of the screen.
 * Android: the nav-bar inset plus NAV_BAR_AIR. iOS keeps what it always had:
 * the home-indicator inset, at least `min`.
 */
export function bottomBarPadding(
  insets: { bottom: number },
  min: number = Spacing.sm,
): number {
  return Platform.OS === 'android'
    ? insets.bottom + NAV_BAR_AIR
    : Math.max(insets.bottom, min);
}
