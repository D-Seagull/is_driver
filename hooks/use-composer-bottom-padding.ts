import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

/**
 * Bottom padding for a chat composer bar. Closed keyboard → clear the safe
 * area (iPhone home indicator / Android nav bar). Open keyboard → the KAV
 * already lifts the bar above the keyboard, so the safe-area padding would
 * only leave a gap; use a small fixed gap instead.
 *
 * Platform files do the keyboard tracking:
 *  - `.ios.ts` — RN `keyboardWillShow/Hide` (fires in sync with the animation)
 *  - `.android.ts` — keyboard-controller events (RN only has `keyboardDid*`
 *    on Android, which fire after the animation and make the bar jump)
 * This base file is the web / type-resolution fallback: no keyboard tracking.
 */
export function useComposerBottomPadding(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, Spacing.sm);
}
