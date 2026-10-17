import { useEffect, useState } from 'react';
import { KeyboardEvents } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

// Small gap between the composer and the open keyboard.
const KEYBOARD_GAP = Spacing.sm;
// A little air above the nav bar with the keyboard closed. The bar's own
// inset sits under the system's (3-button) nav-bar scrim, so without this
// the input row looked glued to the nav bar.
const NAV_BAR_AIR = Spacing.sm;

// Android: RN's Keyboard only emits `keyboardDid*` (after the animation), which
// makes the bar jump by the nav-bar height once the keyboard settles.
// keyboard-controller emits `keyboardWill*` at the animation start (edge-to-edge
// WindowInsetsAnimation) — same source that drives our KeyboardAvoidingView.
export function useComposerBottomPadding(): number {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = KeyboardEvents.addListener('keyboardWillShow', () => setOpen(true));
    const hide = KeyboardEvents.addListener('keyboardWillHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return open ? KEYBOARD_GAP : insets.bottom + NAV_BAR_AIR;
}
