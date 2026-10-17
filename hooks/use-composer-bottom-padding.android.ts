import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { KeyboardController, KeyboardEvents } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { NAV_BAR_AIR } from '@/lib/insets';

// Small gap between the composer and the open keyboard.
const KEYBOARD_GAP = Spacing.sm;

// Android: RN's Keyboard only emits `keyboardDid*` (after the animation), which
// makes the bar jump by the nav-bar height once the keyboard settles.
// keyboard-controller emits `keyboardWill*` at the animation start (edge-to-edge
// WindowInsetsAnimation) — same source that drives our KeyboardAvoidingView.
//
// `will*` alone isn't enough: a sheet or modal opening on top (message actions
// → Reply) takes the keyboard away from another window, the phone locks… and
// no `will` event reaches us. The composer then believed the keyboard was
// still open and dropped to the bare 8 px gap — under the nav bar. So the
// final `did*` events, coming back to the app, and the caller's `resync` (pass
// whatever changes the composer's mode, e.g. the reply / edit target) all
// re-read the real state.
export function useComposerBottomPadding(resync?: unknown): number {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(() => KeyboardController.isVisible());
  // The composer's mode changed → re-read the keyboard right away (state
  // adjusted during render, React's pattern for "props changed").
  const [seenResync, setSeenResync] = useState(resync);
  if (resync !== seenResync) {
    setSeenResync(resync);
    setOpen(KeyboardController.isVisible());
  }

  useEffect(() => {
    const subs = [
      KeyboardEvents.addListener('keyboardWillShow', () => setOpen(true)),
      KeyboardEvents.addListener('keyboardWillHide', () => setOpen(false)),
      KeyboardEvents.addListener('keyboardDidShow', () => setOpen(true)),
      KeyboardEvents.addListener('keyboardDidHide', () => setOpen(false)),
    ];
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') setOpen(KeyboardController.isVisible());
    });
    return () => {
      subs.forEach((s) => s.remove());
      app.remove();
    };
  }, []);


  return open ? KEYBOARD_GAP : insets.bottom + NAV_BAR_AIR;
}
