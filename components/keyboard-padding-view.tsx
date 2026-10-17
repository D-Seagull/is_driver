import { useEffect } from 'react';
import { AppState, type StyleProp, type ViewStyle } from 'react-native';
import {
  KeyboardController,
  KeyboardEvents,
  useKeyboardHandler,
} from 'react-native-keyboard-controller';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * The chat screens' keyboard avoider: pads the screen's bottom by the
 * keyboard's height, following the keyboard frame by frame. It replaces
 * keyboard-controller's KeyboardAvoidingView (behavior "padding").
 *
 * Why not that one: it only ever learns the keyboard height from animation
 * frames. When the keyboard closes while our window isn't animating — phone
 * locked or app sent to the background with the keyboard up, the camera /
 * photo picker opened on top — no closing frames arrive, and the screen
 * stayed lifted by a keyboard-sized gap with no keyboard. The plain
 * "keyboard did hide" event does arrive (the composer's own padding was
 * right), so here it, and coming back to the app, snap to the real state.
 *
 * The padding IS the keyboard height: the chat roots this wraps run to the
 * very bottom of the screen (edge-to-edge), so the keyboard covers exactly its
 * own height of them. Working the overlap out from coordinates broke on
 * Android — react-native's window height leaves out the nav bar (a phantom
 * gap under the composer with the keyboard closed) and measureInWindow
 * ignores the translucent status bar (the open keyboard hid the composer).
 * Only wrap views that reach the bottom of the screen.
 */
export function KeyboardPaddingView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const keyboardHeight = useSharedValue(0);

  useKeyboardHandler(
    {
      onMove: (e) => {
        'worklet';
        keyboardHeight.value = e.height;
      },
      onInteractive: (e) => {
        'worklet';
        keyboardHeight.value = e.height;
      },
      onEnd: (e) => {
        'worklet';
        keyboardHeight.value = e.height;
      },
    },
    [],
  );

  useEffect(() => {
    // Final heights from the events — they arrive even when frames don't.
    const shown = KeyboardEvents.addListener('keyboardDidShow', (e) => {
      keyboardHeight.value = e.height;
    });
    const hidden = KeyboardEvents.addListener('keyboardDidHide', () => {
      keyboardHeight.value = withTiming(0, { duration: 150 });
    });
    // Back from the lock screen / another app: the keyboard is closed by the
    // system meanwhile, often without telling us at all.
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !KeyboardController.isVisible()) {
        keyboardHeight.value = withTiming(0, { duration: 150 });
      }
    });
    return () => {
      shown.remove();
      hidden.remove();
      app.remove();
    };
  }, [keyboardHeight]);

  const padding = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboardHeight.value, 0),
  }));

  return (
    <Animated.View style={[style, padding]}>
      {children}
    </Animated.View>
  );
}
