import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';

// Small gap between the composer and the open keyboard.
const KEYBOARD_GAP = Spacing.sm;

// iOS: `keyboardWill*` fire as the keyboard starts animating, so the padding
// swap rides along with the KAV lift instead of snapping afterwards. `resync`
// (the composer's mode, e.g. reply / edit target) re-reads the real state, as
// on Android.
export function useComposerBottomPadding(resync?: unknown): number {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(() => Keyboard.isVisible());
  // The composer's mode changed → re-read the keyboard right away (state
  // adjusted during render, React's pattern for "props changed").
  const [seenResync, setSeenResync] = useState(resync);
  if (resync !== seenResync) {
    setSeenResync(resync);
    setOpen(Keyboard.isVisible());
  }

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
