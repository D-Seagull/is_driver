import { Ionicons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  useDeleteDocument,
  useTruckDocuments,
  useUploadDocuments,
} from '@/hooks/use-documents';
import { useActiveTrip } from '@/hooks/use-trips';
import { useDriverTruck } from '@/hooks/use-truck';
import { DriverDocument, UploadFileLocal } from '@/lib/documents-api';
import { useUser } from '@/store/auth';

type Tab = 'ALL' | 'PHOTO' | 'DOCUMENT';

interface FolderGroup {
  tripId: string;
  tripTitle: string;
  orderNumber: string | null;
  docs: DriverDocument[];
  photos: number;
  docsCount: number;
  isActive: boolean;
}

export default function DocumentsScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const navigation = useNavigation();
  const { top } = useSafeAreaInsets();
  const user = useUser();
  const { data: truck } = useDriverTruck();
  const { data: activeTrip } = useActiveTrip();

  const truckId = truck?.id ?? user?.currentTruck?.id ?? null;
  const { data: docs, isLoading, refetch, isRefetching } = useTruckDocuments(truckId);
  const upload = useUploadDocuments();

  const [openFolder, setOpenFolder] = useState<FolderGroup | null>(null);

  const folders = useMemo<FolderGroup[]>(() => {
    if (!docs) return [];
    const map = new Map<string, FolderGroup>();
    for (const d of docs) {
      const tripId = d.tripId;
      const existing = map.get(tripId);
      if (existing) {
        existing.docs.push(d);
        if (d.fileType === 'PHOTO') existing.photos++;
        else existing.docsCount++;
      } else {
        map.set(tripId, {
          tripId,
          tripTitle: d.trip?.title ?? 'Trip',
          orderNumber: d.trip?.orderNumber ?? null,
          docs: [d],
          photos: d.fileType === 'PHOTO' ? 1 : 0,
          docsCount: d.fileType === 'DOCUMENT' ? 1 : 0,
          isActive: tripId === activeTrip?.id,
        });
      }
    }
    // Active trip first, then by most-recent doc.
    return Array.from(map.values()).sort((a, b) => {
      if (a.isActive && !b.isActive) return -1;
      if (!a.isActive && b.isActive) return 1;
      const aT = new Date(a.docs[0].createdAt).getTime();
      const bT = new Date(b.docs[0].createdAt).getTime();
      return bT - aT;
    });
  }, [docs, activeTrip?.id]);

  // ─── Upload flow ─────────────────────────────────────────────────────────
  const pickAndUpload = async (
    source: 'camera' | 'gallery' | 'document',
    tripId: string,
  ) => {
    let files: UploadFileLocal[] = [];
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        const r = await ImagePicker.launchCameraAsync({ quality: 0.8 });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? `photo-${Date.now()}.jpg`,
          mimeType: a.mimeType ?? 'image/jpeg',
        }));
      } else if (source === 'gallery') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: true,
          quality: 0.8,
        });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.fileName ?? `photo-${Date.now()}.jpg`,
          mimeType: a.mimeType ?? 'image/jpeg',
        }));
      } else {
        const r = await DocumentPicker.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
          type: '*/*',
        });
        if (r.canceled) return;
        files = r.assets.map((a) => ({
          uri: a.uri,
          name: a.name,
          mimeType: a.mimeType ?? 'application/octet-stream',
        }));
      }

      if (files.length === 0) return;
      await upload.mutateAsync({ tripId, files });
    } catch (e) {
      Alert.alert('Upload failed', (e as Error).message);
    }
  };

  const showUploadSheet = (tripId: string) => {
    Alert.alert('Upload', 'Choose source', [
      { text: 'Camera', onPress: () => pickAndUpload('camera', tripId) },
      { text: 'Gallery', onPress: () => pickAndUpload('gallery', tripId) },
      { text: 'File', onPress: () => pickAndUpload('document', tripId) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ─── UI ──────────────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.header,
          {
            backgroundColor: c.card,
            borderBottomColor: c.border,
            paddingTop: top + Spacing.sm,
          },
        ]}
      >
        <Pressable
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          hitSlop={8}
          style={({ pressed }) => [styles.menuBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="menu" size={24} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>Documents</Text>

        {activeTrip ? (
          <Pressable
            onPress={() => showUploadSheet(activeTrip.id)}
            hitSlop={8}
            style={({ pressed }) => [
              styles.uploadBtn,
              { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            {upload.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
            )}
            <Text style={styles.uploadText}>Upload</Text>
          </Pressable>
        ) : (
          <View style={{ width: 0 }} />
        )}
      </View>

      {!truckId ? (
        <ScreenPlaceholder
          icon="document-text-outline"
          title="No truck assigned"
          subtitle="Documents are linked to your truck. Once your dispatcher assigns one, they'll show up here."
        />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : folders.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
          }
        >
          <ScreenPlaceholder
            icon="folder-open-outline"
            title="No documents yet"
            subtitle={
              activeTrip
                ? 'Tap Upload to add photos or files for the current trip.'
                : "When you have a trip with uploaded files, they'll appear here."
            }
          />
        </ScrollView>
      ) : (
        <FlatList
          data={folders}
          keyExtractor={(f) => f.tripId}
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
          }
          renderItem={({ item }) => (
            <FolderCard folder={item} colors={c} onPress={() => setOpenFolder(item)} />
          )}
        />
      )}

      <FolderModal
        folder={openFolder}
        canUpload={!!activeTrip && openFolder?.tripId === activeTrip.id}
        onClose={() => setOpenFolder(null)}
        onUpload={() => openFolder && showUploadSheet(openFolder.tripId)}
      />
    </View>
  );
}

// ─── Folder card ─────────────────────────────────────────────────────────────

function FolderCard({
  folder,
  colors: c,
  onPress,
}: {
  folder: FolderGroup;
  colors: typeof Colors.light;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.folderCard,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderRadius: Radius.lg,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={[styles.folderIcon, { backgroundColor: c.muted }]}>
        <Ionicons
          name={folder.isActive ? 'folder-open' : 'folder'}
          size={26}
          color={folder.isActive ? c.primary : c.mutedForeground}
        />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.folderTitleRow}>
          <Text style={[styles.folderTitle, { color: c.foreground }]} numberOfLines={1}>
            {folder.tripTitle}
          </Text>
          {folder.isActive && (
            <View style={[styles.activePill, { backgroundColor: c.primary }]}>
              <Text style={styles.activePillText}>Active</Text>
            </View>
          )}
        </View>
        {folder.orderNumber ? (
          <Text style={[styles.folderSub, { color: c.mutedForeground }]}>
            #{folder.orderNumber}
          </Text>
        ) : null}
        <View style={styles.folderMeta}>
          <Ionicons name="image-outline" size={12} color={c.mutedForeground} />
          <Text style={[styles.folderMetaText, { color: c.mutedForeground }]}>
            {folder.photos}
          </Text>
          <Ionicons
            name="document-text-outline"
            size={12}
            color={c.mutedForeground}
            style={{ marginLeft: Spacing.sm }}
          />
          <Text style={[styles.folderMetaText, { color: c.mutedForeground }]}>
            {folder.docsCount}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.mutedForeground} />
    </Pressable>
  );
}

// ─── Folder modal with tabs ──────────────────────────────────────────────────

function FolderModal({
  folder,
  canUpload,
  onClose,
  onUpload,
}: {
  folder: FolderGroup | null;
  canUpload: boolean;
  onClose: () => void;
  onUpload: () => void;
}) {
  const c = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('ALL');
  const del = useDeleteDocument();

  const filtered = useMemo(() => {
    if (!folder) return [];
    if (tab === 'ALL') return folder.docs;
    return folder.docs.filter((d) => d.fileType === tab);
  }, [folder, tab]);

  const handleOpenDoc = async (doc: DriverDocument) => {
    try {
      await WebBrowser.openBrowserAsync(doc.signedUrl);
    } catch (e) {
      Alert.alert('Cannot open', (e as Error).message);
    }
  };

  const handleDelete = (doc: DriverDocument) => {
    Alert.alert('Delete?', `${doc.fileName} will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => del.mutate(doc.id),
      },
    ]);
  };

  const counts = {
    ALL: folder?.docs.length ?? 0,
    PHOTO: folder?.photos ?? 0,
    DOCUMENT: folder?.docsCount ?? 0,
  };

  return (
    <Modal
      visible={!!folder}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View
          style={[
            styles.modalHeader,
            {
              backgroundColor: c.card,
              borderBottomColor: c.border,
              paddingTop: insets.top + Spacing.sm,
            },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 4 }]}
          >
            <Ionicons name="close" size={24} color={c.foreground} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modalTitle, { color: c.foreground }]} numberOfLines={1}>
              {folder?.tripTitle ?? ''}
            </Text>
            {folder?.orderNumber ? (
              <Text style={[styles.modalSub, { color: c.mutedForeground }]}>
                #{folder.orderNumber}
              </Text>
            ) : null}
          </View>
          {canUpload && (
            <Pressable
              onPress={onUpload}
              hitSlop={8}
              style={({ pressed }) => [
                styles.uploadBtn,
                { backgroundColor: c.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
              <Text style={styles.uploadText}>Upload</Text>
            </Pressable>
          )}
        </View>

        {/* Tabs */}
        <View style={[styles.tabs, { borderBottomColor: c.border }]}>
          {(['ALL', 'PHOTO', 'DOCUMENT'] as Tab[]).map((t) => {
            const active = t === tab;
            const label = t === 'ALL' ? 'All' : t === 'PHOTO' ? 'Photos' : 'Documents';
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={[
                  styles.tab,
                  active && { borderBottomColor: c.primary, borderBottomWidth: 2 },
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    {
                      color: active ? c.primary : c.mutedForeground,
                      fontWeight: active ? '700' : '500',
                    },
                  ]}
                >
                  {label} ({counts[t]})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* List */}
        {filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: c.mutedForeground }}>Nothing here yet.</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(d) => d.id}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
            renderItem={({ item }) => (
              <DocCard
                doc={item}
                colors={c}
                onOpen={() => handleOpenDoc(item)}
                onDelete={() => handleDelete(item)}
                deleting={del.isPending && del.variables === item.id}
              />
            )}
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Doc card ────────────────────────────────────────────────────────────────

function DocCard({
  doc,
  colors: c,
  onOpen,
  onDelete,
  deleting,
}: {
  doc: DriverDocument;
  colors: typeof Colors.light;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isPhoto = doc.fileType === 'PHOTO';
  const created = new Date(doc.createdAt).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.docCard,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderRadius: Radius.md,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      {isPhoto ? (
        <Image source={{ uri: doc.signedUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, { backgroundColor: c.muted, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name="document-text-outline" size={24} color={c.mutedForeground} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.docName, { color: c.foreground }]} numberOfLines={2}>
          {doc.fileName}
        </Text>
        <Text style={[styles.docSub, { color: c.mutedForeground }]}>
          {created}
          {doc.uploader?.name ? ` · ${doc.uploader.name}` : ''}
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        hitSlop={8}
        disabled={deleting}
        style={({ pressed }) => [
          styles.docDelete,
          { opacity: pressed || deleting ? 0.5 : 1 },
        ]}
      >
        {deleting ? (
          <ActivityIndicator size="small" color={c.destructive} />
        ) : (
          <Ionicons name="trash-outline" size={18} color={c.destructive} />
        )}
      </Pressable>
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700' },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.md,
  },
  uploadText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Folder cards
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  folderIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  folderTitle: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  folderSub: { fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
  folderMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  folderMetaText: { fontSize: 12, fontWeight: '600' },
  activePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activePillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  // Modal
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalSub: { fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  tabText: { fontSize: 13 },

  // Doc card
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 56, height: 56, borderRadius: Radius.sm },
  docName: { fontSize: 14, fontWeight: '600' },
  docSub: { fontSize: 11, marginTop: 2 },
  docDelete: { padding: 6 },
});
