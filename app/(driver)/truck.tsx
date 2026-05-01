import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useCreateTruckNote,
  useDeleteTruckNote,
  useDriverTruck,
} from '@/hooks/use-truck';
import { TruckNote, TruckStatus } from '@/lib/types';
import { useUser } from '@/store/auth';

// ─── Status badge ────────────────────────────────────────────────────────────

const TRUCK_STATUS_COLORS: Record<TruckStatus, { bg: string; text: string }> = {
  AVAILABLE: { bg: '#D1FAE5', text: '#065F46' },
  ON_TRIP:   { bg: '#DBEAFE', text: '#1E40AF' },
  REPAIR:    { bg: '#FEE2E2', text: '#991B1B' },
};

const TRUCK_STATUS_LABELS: Record<TruckStatus, string> = {
  AVAILABLE: 'Available',
  ON_TRIP:   'On trip',
  REPAIR:    'Repair',
};

function TruckStatusBadge({ status }: { status: TruckStatus }) {
  const { bg, text } = TRUCK_STATUS_COLORS[status] ?? TRUCK_STATUS_COLORS.AVAILABLE;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: text }]}>
        {TRUCK_STATUS_LABELS[status] ?? status}
      </Text>
    </View>
  );
}

// ─── Info row ────────────────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: c.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: c.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Note card ───────────────────────────────────────────────────────────────

function NoteCard({
  note,
  canDelete,
  onDelete,
}: {
  note: TruckNote;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const date = new Date(note.createdAt).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return (
    <View
      style={[
        styles.noteCard,
        { backgroundColor: c.muted, borderColor: c.border },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.noteContent, { color: c.foreground }]}>
          {note.content}
        </Text>
        <Text style={[styles.noteMeta, { color: c.mutedForeground }]}>
          {note.user.name ?? 'Unknown'} · {date}
        </Text>
      </View>
      {canDelete && (
        <Pressable onPress={onDelete} hitSlop={8}>
          <Ionicons name="trash-outline" size={16} color={c.destructive} />
        </Pressable>
      )}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function TruckScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const user = useUser();

  const { data: truck, isLoading, isRefetching, refetch } = useDriverTruck();
  const createNote = useCreateTruckNote(truck?.id);
  const deleteNote = useDeleteTruckNote(truck?.id);

  const [noteText, setNoteText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleAddNote = async () => {
    const content = noteText.trim();
    if (!content || !truck) return;
    setIsSending(true);
    try {
      await createNote.mutateAsync(content);
      setNoteText('');
    } catch {
      Alert.alert('Error', 'Could not save note. Please try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteNote = (noteId: string) => {
    Alert.alert('Delete note', 'Remove this note?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteNote.mutate(noteId),
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  if (!truck) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: c.background }}
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
      >
        <ScreenPlaceholder
          icon="car-outline"
          title="No truck assigned"
          subtitle="When a dispatcher assigns a truck to you, it'll appear here."
        />
      </ScrollView>
    );
  }

  const dispatcher = truck.dispatcher;
  const notes = truck.truckNotes ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={styles.body}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Truck info card ── */}
      <View
        style={[
          styles.card,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.plateRow}>
            <MaterialCommunityIcons
              name="truck-outline"
              size={22}
              color={c.primary}
            />
            <Text style={[styles.plate, { color: c.foreground }]}>
              {truck.plate}
            </Text>
          </View>
          <TruckStatusBadge status={truck.status} />
        </View>

        {dispatcher && (
          <InfoRow
            icon={
              <Ionicons name="person-circle-outline" size={18} color={c.mutedForeground} />
            }
            label="Dispatcher"
            value={
              dispatcher.name
                ? dispatcher.phone
                  ? `${dispatcher.name} · ${dispatcher.phone}`
                  : dispatcher.name
                : dispatcher.phone ?? '—'
            }
          />
        )}
      </View>

      {/* ── Notes section ── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="document-text-outline" size={16} color={c.mutedForeground} />
        <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>
          Notes ({notes.length})
        </Text>
      </View>

      {/* Add note input */}
      <View
        style={[
          styles.noteInputWrap,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <TextInput
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Add a note visible to dispatcher…"
          placeholderTextColor={c.mutedForeground}
          style={[styles.noteInput, { color: c.foreground }]}
          multiline
          maxLength={500}
        />
        <Pressable
          onPress={handleAddNote}
          disabled={!noteText.trim() || isSending}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor:
                !noteText.trim() || isSending ? c.muted : c.primary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          {isSending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={16} color="#fff" />
          )}
        </Pressable>
      </View>

      {/* Notes list */}
      {notes.length === 0 ? (
        <View style={[styles.emptyNotes, { borderColor: c.border }]}>
          <Text style={[styles.emptyNotesText, { color: c.mutedForeground }]}>
            No notes yet. Add one above.
          </Text>
        </View>
      ) : (
        <View style={{ gap: Spacing.sm }}>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              canDelete={note.userId === user?.id}
              onDelete={() => handleDeleteNote(note.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  body: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  plateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  plate: { fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  badgeText: { fontSize: 12, fontWeight: '600' },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  infoIcon: { marginTop: 2 },
  infoLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  infoValue: { fontSize: 14, marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: -Spacing.sm,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  noteInputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.sm,
  },
  noteInput: {
    flex: 1,
    fontSize: 14,
    maxHeight: 100,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  noteContent: { fontSize: 14, lineHeight: 20 },
  noteMeta: { fontSize: 11 },

  emptyNotes: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  emptyNotesText: { fontSize: 13 },
});
