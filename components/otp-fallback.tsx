import { Ionicons } from "@expo/vector-icons";
import { isAxiosError } from "axios";
import { useEffect, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "@/constants/theme";
import { fetchOtpChannels, type OtpChannel, type OtpChannels } from "@/lib/auth-api";
import { useAuthStore } from "@/store/auth";

// How long the SMS gets before we offer other ways.
const FALLBACK_AFTER_S = 45;

const ICONS: Record<OtpChannel, ComponentProps<typeof Ionicons>["name"]> = {
  sms: "chatbox-outline",
  email: "mail-outline",
  whatsapp: "logo-whatsapp",
  telegram: "paper-plane-outline",
  manager: "person-outline",
};

/**
 * "Didn't get the code?" under the code field. Appears ~45 s after the SMS
 * went out and offers the channels the server allows for this phone —
 * email only when the driver has a confirmed one, "ask my manager" always
 * last. Every channel ends on the same code screen.
 */
export function OtpFallback({
  phone,
  disabled,
  c,
}: {
  phone: string;
  disabled: boolean;
  c: (typeof Colors)["light"];
}) {
  const { t } = useTranslation();
  const requestVia = useAuthStore((s) => s.requestOtpVia);
  const [wait, setWait] = useState(FALLBACK_AFTER_S);
  const [offer, setOffer] = useState<OtpChannels | null>(null);
  const [sending, setSending] = useState<OtpChannel | null>(null);
  const [sent, setSent] = useState<OtpChannel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  useEffect(() => {
    if (wait > 0 || offer) return;
    let alive = true;
    void fetchOtpChannels(phone).then((o) => alive && setOffer(o));
    return () => {
      alive = false;
    };
  }, [wait, offer, phone]);

  if (!offer) return null;

  const send = async (channel: OtpChannel) => {
    setError(null);
    setSending(channel);
    try {
      await requestVia(phone, channel);
      setSent(channel);
    } catch (e) {
      const data = isAxiosError(e)
        ? (e.response?.data as { message?: string | string[] } | undefined)
        : undefined;
      const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
      setError(msg ?? t("auth.otp.fallback.failed"));
    } finally {
      setSending(null);
    }
  };

  const label = (ch: OtpChannel) =>
    ch === "email" && offer.emailHint
      ? t("auth.otp.fallback.emailTo", { email: offer.emailHint })
      : t(`auth.otp.fallback.${ch}`);

  // Direct channels first, then the manager — the last resort.
  const direct = offer.channels.filter((ch) => ch !== "manager");
  const withManager = offer.channels.includes("manager");

  const option = (ch: OtpChannel) => (
    <Pressable
      key={ch}
      onPress={() => send(ch)}
      disabled={disabled || sending !== null}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: c.border,
          backgroundColor: c.card,
          borderRadius: Radius.md,
          opacity: sending && sending !== ch ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      {sending === ch ? (
        <ActivityIndicator color={c.primary} />
      ) : (
        <Ionicons name={ICONS[ch]} size={18} color={c.primary} />
      )}
      <Text style={[styles.optionText, { color: c.foreground }]}>{label(ch)}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.box, { borderColor: c.border }]}>
      <Text style={[styles.title, { color: c.foreground }]}>
        {t("auth.otp.fallback.title")}
      </Text>
      {direct.map(option)}
      {withManager && (
        <>
          {option("manager")}
          <Text style={[styles.note, { color: c.mutedForeground }]}>
            {t("auth.otp.fallback.managerNote")}
          </Text>
        </>
      )}
      {sent && (
        <Text style={[styles.sent, { color: c.foreground }]}>
          {t(`auth.otp.fallback.sent.${sent}`)}
        </Text>
      )}
      {error && (
        <Text style={[styles.note, { color: c.destructive }]}>{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  title: { fontSize: 15, fontWeight: "700" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  optionText: { fontSize: 14, fontWeight: "500", flexShrink: 1 },
  note: { fontSize: 12 },
  sent: { fontSize: 13, textAlign: "center" },
});
