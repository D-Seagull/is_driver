import { useEffect } from 'react';
import {
  AppState,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
 * The chat screens' keyboard avoider: pads the screen's bottom by however
 * much of it the keyboard covers, following the keyboard frame by frame —
 * same maths as keyboard-controller's KeyboardAvoidingView (behavior
 * "padding"), which it replaces.
 *
 * Why not that one: it only ever learns the keyboard height from animation
 * frames. When the keyboard closes while our window isn't animating — phone
 * locked or app sent to the background with the keyboard up, the camera /
 * photo picker opened on top — no closing frames arrive, and the screen
 * stayed lifted by a keyboard-sized gap with no keyboard. The plain
 * "keyboard did hide" event does arrive (the composer's own padding was
 * right), so here it, and coming back to the app, snap to the real state.
 */
export function KeyboardPaddingView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useSharedValue(0);
  // Bottom edge of this view in the window — the keyboard only needs to be
  // avoided where it overlaps us.
  const bottom = useSharedValue(windowHeight);

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

  const onLayout = (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    bottom.value = y + height;
  };

  const padding = useAnimatedStyle(() => {
    const keyboardTop = windowHeight - keyboardHeight.value;
    return { paddingBottom: Math.max(bottom.value - keyboardTop, 0) };
  }, [windowHeight]);

  return (
    <Animated.View style={[style, padding]} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}
