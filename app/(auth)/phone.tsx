import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import axios from 'axios';
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
import { useAuthStore } from '@/store/auth';

export default function PhoneScreen() {
  const router = useRouter();
  const c = Colors[useColorScheme() ?? 'light'];
  const requestOtp = useAuthStore((s) => s.requestOtp);

  const [phone, setPhone] = useState('+380');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = phone.replace(/\D/g, '').length >= 9 && !submitting;

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await requestOtp(phone.trim());
      router.push({ pathname: '/(auth)/otp', params: { phone: phone.trim() } });
    } catch (e) {
      // Surface the real cause so the user can act: bad URL, server down, 400, etc.
      if (axios.isAxiosError(e)) {
        if (e.response) {
          const data = e.response.data as { message?: string | string[] };
          const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
          setError(msg ?? `Server error (${e.response.status})`);
        } else if (e.request) {
          setError(
            `Cannot reach server. Check that the backend is running and EXPO_PUBLIC_API_URL is correct.`,
          );
        } else {
          setError(e.message);
        }
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Failed to send code.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: c.background }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.muted }]}>
        <Ionicons name="call-outline" size={36} color={c.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: c.foreground }]}>Sign in</Text>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        Enter your phone number — we&apos;ll send a one-time code via SMS.
      </Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="+380 50 000 0000"
        placeholderTextColor={c.mutedForeground}
        keyboardType="phone-pad"
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
          <Text style={[styles.btnText, { color: c.primaryForeground }]}>Send code</Text>
        )}
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
    fontSize: 16,
  },
  error: { fontSize: 13, marginTop: -Spacing.xs },
  btn: {
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  btnText: { fontSize: 16, fontWeight: '700' },
});
