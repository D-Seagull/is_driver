import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

// Small gap between the composer and the open keyboard.
const KEYBOARD_GAP = Spacing.sm;

// iOS: `keyboardWill*` fire as the keyboard starts animating, so the padding
// swap rides along with the KAV lift instead of snapping afterwards.
export function useComposerBottomPadding(): number {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return open ? KEYBOARD_GAP : Math.max(insets.bottom, Spacing.sm);
}
