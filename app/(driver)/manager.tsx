import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useManagerProfile,
  useManagerRatings,
  useRateManager,
} from '@/hooks/use-manager-rating';
import { useUser } from '@/store/auth';
import { useDriverTruck } from '@/hooks/use-truck';
import { fullName } from '@/lib/format';
import type { ManagerRating } from '@/lib/manager-api';

/**
 * Manager profile screen for the driver app — opened by tapping the manager
 * row in the sidebar or the manager block on the Truck screen.
 *
 * Read-only profile + a Rate button that opens a 1–5 star sheet. Driver can
 * also edit their existing rating (backend upserts).
 */
export default function ManagerScreen() {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const me = useUser();
  // The driver's manager is the manager of the truck they're currently on
  // (this is what the sidebar row shows and taps through from). Fall back to
  // the user-record manager only when no truck is assigned yet.
  const { data: truck } = useDriverTruck();
  const managerId = truck?.manager?.id ?? me?.manager?.id ?? null;

  const { data: profile, isLoading } = useManagerProfile(managerId);
  const { data: ratingsData } = useManagerRatings(managerId);
  const rate = useRateManager(managerId ?? '');

  const ratings = ratingsData?.ratings ?? [];
  const avg = ratingsData?.averageRating ?? profile?.managerAverageRating ?? null;
  const ratingCount =
    ratingsData?.ratingCount ?? profile?.managerRatingCount ?? 0;
  // Find this driver's own rating to pre-fill the modal (upsert semantics).
  const mine = ratings.find((r) => r.ratedBy.id === me?.id);
  // Everyone else's reviews — shown as a list below your own.
  const others = ratings.filter((r) => r.ratedBy.id !== me?.id);

  const [modalOpen, setModalOpen] = useState(false);

  if (!managerId) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Stack.Screen options={{ title: t('nav.manager') }} />
        <Ionicons
          name="person-outline"
          size={48}
          color={c.mutedForeground}
        />
        <Text style={[styles.placeholder, { color: c.mutedForeground }]}>
          {t('manager.noManager')}
        </Text>
      </View>
    );
  }

  if (isLoading || !profile) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <Stack.Screen options={{ title: t('nav.manager') }} />
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  const displayName = fullName(profile) || profile.email || t('nav.manager');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        padding: Spacing.lg,
        paddingBottom: insets.bottom + Spacing.lg,
        gap: Spacing.lg,
      }}
    >
      <Stack.Screen options={{ title: t('nav.manager') }} />

      {/* Profile card */}
      <View
        style={[
          styles.card,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={styles.headerRow}>
          {profile.avatar ? (
            <Image source={{ uri: profile.avatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: c.muted }]}>
              <Ionicons
                name="person"
                size={32}
                color={c.mutedForeground}
              />
            </View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.name, { color: c.foreground }]}>
              {displayName}
            </Text>
            <View style={styles.ratingRow}>
              {avg !== null ? (
                <>
                  <Ionicons name="star" size={14} color="#fbbf24" />
                  <Text style={[styles.ratingText, { color: c.foreground }]}>
                    {avg.toFixed(1)}
                  </Text>
                  <Text
                    style={[
                      styles.ratingMeta,
                      { color: c.mutedForeground },
                    ]}
                  >
                    {t('manager.ratingCount', { count: ratingCount })}
                  </Text>
                </>
              ) : (
                <Text
                  style={[styles.ratingMeta, { color: c.mutedForeground }]}
                >
                  {t('manager.noRatings')}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <InfoRow
          icon="mail-outline"
          label={t('manager.info.email')}
          value={profile.email ?? '—'}
          colors={c}
        />
        <InfoRow
          icon="call-outline"
          label={t('manager.info.phone')}
          value={profile.phone ?? '—'}
          colors={c}
        />
      </View>

      {/* Rate action */}
      <Pressable
        style={({ pressed }) => [
          styles.rateBtn,
          {
            backgroundColor: c.primary,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
        onPress={() => setModalOpen(true)}
      >
        <Ionicons name="star" size={18} color="#fff" />
        <Text style={styles.rateBtnText}>
          {mine ? t('manager.updateRating') : t('manager.rate')}
        </Text>
      </Pressable>

      {mine && (
        <View
          style={[
            styles.myRating,
            { backgroundColor: c.muted, borderColor: c.border },
          ]}
        >
          <Text style={[styles.myRatingTitle, { color: c.mutedForeground }]}>
            {t('manager.yourRating')}
          </Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Ionicons
                key={n}
                name={n <= mine.score ? 'star' : 'star-outline'}
                size={16}
                color="#fbbf24"
              />
            ))}
          </View>
          {mine.comment ? (
            <Text style={[styles.myRatingComment, { color: c.foreground }]}>
              “{mine.comment}”
            </Text>
          ) : null}
        </View>
      )}

      {/* Other drivers' reviews */}
      {others.length > 0 && (
        <View style={{ gap: Spacing.sm }}>
          <Text style={[styles.reviewsTitle, { color: c.mutedForeground }]}>
            {t('manager.reviews', { count: others.length })}
          </Text>
          {others.map((r) => (
            <ReviewCard key={r.id} rating={r} colors={c} />
          ))}
        </View>
      )}

      <RateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialScore={mine?.score ?? 0}
        initialComment={mine?.comment ?? ''}
        initialAnonymous={mine?.anonymous ?? false}
        submitting={rate.isPending}
        onSubmit={async (payload) => {
          await rate.mutateAsync(payload);
          setModalOpen(false);
        }}
        colors={c}
      />
    </ScrollView>
  );
}

function InfoRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  colors: typeof Colors.light;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
          {label}
        </Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function ReviewCard({
  rating,
  colors: c,
}: {
  rating: ManagerRating;
  colors: typeof Colors.light;
}) {
  const { t } = useTranslation();
  // Anonymous reviews arrive from the backend with the name already masked
  // to "Anonymous", so we can render the raw name safely.
  const name = fullName(rating.ratedBy) || t('nav.driverFallback');
  const date = new Date(rating.createdAt).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return (
    <View style={[styles.reviewCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.reviewTop}>
        <Text style={[styles.reviewName, { color: c.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Ionicons
              key={n}
              name={n <= rating.score ? 'star' : 'star-outline'}
              size={13}
              color="#fbbf24"
            />
          ))}
        </View>
      </View>
      {rating.comment ? (
        <Text style={[styles.reviewComment, { color: c.foreground }]}>
          {rating.comment}
        </Text>
      ) : null}
      <Text style={[styles.reviewDate, { color: c.mutedForeground }]}>{date}</Text>
    </View>
  );
}

function RateModal({
  open,
  onClose,
  initialScore,
  initialComment,
  initialAnonymous,
  submitting,
  onSubmit,
  colors,
}: {
  open: boolean;
  onClose: () => void;
  initialScore: number;
  initialComment: string;
  initialAnonymous: boolean;
  submitting: boolean;
  onSubmit: (payload: {
    score: number;
    comment?: string;
    anonymous?: boolean;
  }) => Promise<void>;
  colors: typeof Colors.light;
}) {
  const { t } = useTranslation();
  const [score, setScore] = useState(initialScore);
  const [comment, setComment] = useState(initialComment);
  const [anonymous, setAnonymous] = useState(initialAnonymous);

  // Reset when reopening (covers the case where the manager swaps too).
  useEffect(() => {
    if (open) {
      setScore(initialScore);
      setComment(initialComment);
      setAnonymous(initialAnonymous);
    }
  }, [open, initialScore, initialComment, initialAnonymous]);

  const handleSubmit = () => {
    if (score < 1) return;
    void onSubmit({
      score,
      comment: comment.trim() || undefined,
      anonymous,
    });
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.modalCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          onPress={() => {}}
        >
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            {t('manager.modal.title')}
          </Text>

          {/* Stars */}
          <View style={styles.starsRowLg}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                onPress={() => setScore(n)}
                hitSlop={8}
              >
                <Ionicons
                  name={n <= score ? 'star' : 'star-outline'}
                  size={36}
                  color="#fbbf24"
                />
              </Pressable>
            ))}
          </View>

          {/* Comment — single line. Multiline TextInput on Expo Go iOS
              currently regresses input handling (see is-driver/trip.tsx). */}
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder={t('manager.modal.commentPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            maxLength={300}
            style={[
              styles.commentInput,
              {
                color: colors.foreground,
                backgroundColor: colors.muted,
                borderColor: colors.border,
              },
            ]}
            returnKeyType="done"
          />

          {/* Anonymous */}
          <View style={styles.anonRow}>
            <Text style={{ color: colors.foreground, flex: 1 }}>
              {t('manager.modal.anonymous')}
            </Text>
            <Switch
              value={anonymous}
              onValueChange={setAnonymous}
              trackColor={{ true: colors.primary, false: colors.muted }}
            />
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <Pressable
              style={({ pressed }) => [
                styles.modalBtn,
                styles.modalBtnGhost,
                { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={onClose}
            >
              <Text style={{ color: colors.foreground, fontWeight: '600' }}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.modalBtn,
                {
                  backgroundColor:
                    score === 0 || submitting ? colors.muted : colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              onPress={handleSubmit}
              disabled={score === 0 || submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '600' }}>
                  {t('manager.modal.submit')}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  placeholder: {
    fontSize: 14,
    marginTop: Spacing.sm,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 20, fontWeight: '700' },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: { fontSize: 14, fontWeight: '600' },
  ratingMeta: { fontSize: 12 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb33',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  infoLabel: { fontSize: 11 },
  infoValue: { fontSize: 14, fontWeight: '500' },
  rateBtn: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  rateBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  myRating: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 6,
  },
  myRatingTitle: { fontSize: 11 },
  starsRow: { flexDirection: 'row', gap: 2 },
  starsRowLg: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
  },
  myRatingComment: { fontSize: 13, fontStyle: 'italic' },
  reviewsTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: Spacing.sm,
  },
  reviewCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 6,
  },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  reviewName: { fontSize: 14, fontWeight: '600', flex: 1 },
  reviewComment: { fontSize: 13, lineHeight: 18 },
  reviewDate: { fontSize: 11 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  modalCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  commentInput: {
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    fontSize: 14,
  },
  anonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnGhost: {
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'transparent',
  },
});

// Exported so router-store sees a default export.
void router;
