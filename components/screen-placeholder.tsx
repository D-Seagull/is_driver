import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
};

export function ScreenPlaceholder({ icon, title, subtitle }: Props) {
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
});
