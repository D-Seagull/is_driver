import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatAvatar } from '@/components/chat-avatar';
import { StatusDot } from '@/components/status-dot';
import { Colors, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { DriverUserStatus } from '@/lib/auth-api';
import { useManagerProfile } from '@/hooks/use-manager-rating';
import { fullName } from '@/lib/format';

const LANG_LABELS: Record<string, string> = {
  EN: 'English',
  UK: 'Українська',
  PL: 'Polski',
  LT: 'Lietuvių',
  DE: 'Deutsch',
  RU: 'Русский',
};

/**
 * A read-only mini profile — opened by tapping a sender's name in chat. Shows
 * who someone is (name, role, contacts, language, team lead) without any
 * actions. Available to every user; backed by GET /users/:id.
 */
export function UserCardSheet({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const { data: person, isLoading } = useManagerProfile(userId);

  return (
    <Modal
      transparent
      visible={!!userId}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              paddingBottom: Math.max(insets.bottom, Spacing.md) + Spacing.md,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.grabber, { backgroundColor: c.border }]} />

          {isLoading || !person ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : (
            <>
              <View style={styles.profile}>
                <View>
                  <ChatAvatar user={person} size={56} />
                  <View style={styles.dotWrap}>
                    <StatusDot
                      user={{
                        id: person.id,
                        status: (person.status ?? null) as DriverUserStatus | null,
                        statusUntil: person.statusUntil ?? null,
                      }}
                      size={13}
                      ring={c.card}
                    />
                  </View>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
                    {fullName(person) || '—'}
                  </Text>
                  <Text style={[styles.role, { color: c.mutedForeground }]}>
                    {person.role}
                  </Text>
                </View>
              </View>

              <View style={styles.info}>
                {person.phone ? (
                  <Row icon="call-outline" label={t('login.phone', 'Телефон')} value={person.phone} c={c} />
                ) : null}
                {person.email ? (
                  <Row icon="mail-outline" label={t('login.email', 'Email')} value={person.email} c={c} />
                ) : null}
                {person.language ? (
                  <Row
                    icon="language-outline"
                    label={t('settings.language.title', 'Мова')}
                    value={LANG_LABELS[person.language] ?? person.language}
                    c={c}
                  />
                ) : null}
                {person.teamlead ? (
                  <Row
                    icon="ribbon-outline"
                    label={t('chatDir.teamlead', 'Тімлід')}
                    value={fullName(person.teamlead) || '—'}
                    c={c}
                  />
                ) : null}
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  icon,
  iconNode,
  label,
  value,
  c,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconNode?: ReactNode;
  label: string;
  value: string;
  c: ThemeColors;
}) {
  return (
    <View style={styles.row}>
      {iconNode ?? <Ionicons name={icon ?? 'ellipse-outline'} size={16} color={c.mutedForeground} />}
      <Text style={{ color: c.mutedForeground, fontSize: 13, width: 84 }}>{label}</Text>
      <Text style={{ flex: 1, color: c.foreground, fontSize: 14 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: Spacing.sm },
  center: { paddingVertical: Spacing.xl, alignItems: 'center', justifyContent: 'center' },
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  dotWrap: { position: 'absolute', right: -2, bottom: -2 },
  name: { fontSize: 18, fontWeight: '700' },
  role: { fontSize: 13, marginTop: 2, textTransform: 'capitalize' },
  info: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 8 },
});
