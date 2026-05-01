import { Ionicons } from '@expo/vector-icons';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MOCK_AUTH } from '@/lib/config';
import { useAuthStore } from '@/store/auth';

export default function OtpScreen() {
  const router = useRouter();
  const { phone = '' } = useLocalSearchParams<{ phone?: string }>();
  const c = Colors[useColorScheme() ?? 'light'];
  const verifyOtp = useAuthStore((s) => s.verifyOtp);

  // If we land here without a phone (e.g. dev-mode route restore), bounce
  // back to the phone screen so the user can request a code first.
  if (!phone) {
    return <Redirect href="/(auth)/phone" />;
  }

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = code.length === 6 && !submitting;

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await verifyOtp(phone, code);
      // Decide initial screen based on whether the driver has a truck assigned.
      // No truck → drop straight into the dispatcher chat. With truck → Trip chat.
      const user = useAuthStore.getState().user;
      const target = user?.currentTruck ? '/(driver)/trip' : '/(driver)/chat';
      router.replace(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: c.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.muted }]}>
        <Ionicons name="shield-checkmark-outline" size={36} color={c.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: c.foreground }]}>Enter code</Text>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        We sent a 6-digit code to {phone || 'your phone'}.
      </Text>
      <TextInput
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        placeholder="••••••"
        placeholderTextColor={c.mutedForeground}
        keyboardType="number-pad"
        editable={!submitting}
        style={[
          styles.input,
          {
            color: c.foreground,
            backgroundColor: c.card,
            borderColor: c.input,
            borderRadius: Radius.md,
          },
        ]}
      />
      {MOCK_AUTH && (
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          Mock mode — any 6 digits will work (e.g. 123456).
        </Text>
      )}
      {error && (
        <Text style={[styles.error, { color: c.destructive }]}>{error}</Text>
      )}
      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.btn,
          {
            backgroundColor: c.primary,
            opacity: !canSubmit ? 0.5 : pressed ? 0.85 : 1,
            borderRadius: Radius.md,
          },
        ]}
      >
        {submitting ? (
          <ActivityIndicator color={c.primaryForeground} />
        ) : (
          <Text style={[styles.btnText, { color: c.primaryForeground }]}>Verify</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => router.replace('/(auth)/phone')}
        disabled={submitting}
        style={({ pressed }) => [styles.linkBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.linkText, { color: c.mutedForeground }]}>
          Change phone number
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: 96,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { fontSize: 26, fontWeight: '700' },
  sub: { fontSize: 14, marginBottom: Spacing.md },
  input: {
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: 22,
    letterSpacing: 8,
    textAlign: 'center',
  },
  hint: { fontSize: 12, textAlign: 'center', marginTop: -Spacing.xs },
  error: { fontSize: 13 },
  btn: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  btnText: { fontSize: 16, fontWeight: '700' },
  linkBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  linkText: { fontSize: 13, fontWeight: '500' },
});
