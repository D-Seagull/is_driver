import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { Colors, Spacing } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

/**
 * "Anna, Petro набирають ⋯" row shown above the composer — shared by the
 * trip chat, DMs and groups. Renders nothing when nobody is typing.
 */
export function TypingIndicator({ names }: { names: string[] }) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? "light"];
  if (names.length === 0) return null;
  return (
    <View style={[styles.row, { backgroundColor: c.background }]}>
      <Text style={[styles.text, { color: c.mutedForeground }]} numberOfLines={1}>
        {names.join(", ")}{" "}
        {names.length === 1 ? t("chat.typingOne") : t("chat.typingMany")}
      </Text>
      <TypingDots color={c.mutedForeground} />
    </View>
  );
}

export function TypingDots({ color }: { color: string }) {
  // Three Animated values, started with staggered delays so the dots bounce
  // in a "wave". Same visual rhythm as the web `animate-bounce delay-0/100/200`.
  const [dots] = useState(() => [
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]);

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={{ flexDirection: "row", gap: 2 }}>
      {dots.map((dot, i) => (
        <Animated.Text
          key={i}
          style={[
            { color, fontSize: 14, lineHeight: 14 },
            {
              transform: [
                {
                  translateY: dot.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -3],
                  }),
                },
              ],
            },
          ]}
        >
          .
        </Animated.Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  text: { fontSize: 11 },
});
