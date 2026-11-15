import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  /** Optional button under the text. */
  action?: { label: string; icon?: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void };
};

export function ScreenPlaceholder({ icon, title, subtitle, action }: Props) {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={[styles.wrap, { backgroundColor: c.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.muted }]}>
        <Ionicons name={icon} size={40} color={c.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: c.foreground }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.sub, { color: c.mutedForeground }]}>{subtitle}</Text>
      ) : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          {action.icon ? <Ionicons name={action.icon} size={18} color={c.primaryForeground} /> : null}
          <Text style={[styles.actionText, { color: c.primaryForeground }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 20, fontWeight: '700' },
  sub: { fontSize: 14, textAlign: 'center', maxWidth: 280 },
  action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: 24, paddingHorizontal: Spacing.lg, paddingVertical: 12, marginTop: Spacing.sm },
  actionText: { fontSize: 15, fontWeight: '700' },
});
