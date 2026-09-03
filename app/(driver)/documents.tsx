import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fullName } from "@/lib/format";
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
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationBell } from '@/components/notification-bell';
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
import { formatDate } from '@/lib/format-date';
import { useUser } from '@/store/auth';

type Tab = 'ALL' | 'PHOTO' | 'DOCUMENT';

interface FolderGroup {
  tripId: string;
  tripTitle: string;
  orderNumber: string | null;
  /** Lowercased haystack for search: title + order# + stop addresses + date. */
  search: string;
  docs: DriverDocument[];
  photos: number;
  docsCount: number;
  isActive: boolean;
}

export default function DocumentsScreen() {
  const { t } = useTranslation();
  const c = Colors[useColorScheme() ?? 'light'];
  const navigation =
    useNavigation<DrawerNavigationProp<Record<string, object | undefined>>>();
  const { top } = useSafeAreaInsets();
  const user = useUser();
  const { data: truck } = useDriverTruck();
  const { data: activeTrip } = useActiveTrip();

  const truckId = truck?.id ?? user?.currentTruck?.id ?? null;
  const { data: docs, isLoading, refetch, isRefetching } = useTruckDocuments(truckId);
  const upload = useUploadDocuments();

  const [openFolder, setOpenFolder] = useState<FolderGroup | null>(null);
  const [query, setQuery] = useState('');

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
        const trip = d.trip;
        const stopsText = (trip?.stops ?? [])
          .map((s) => s.address ?? '')
          .join(' ');
        const dt = new Date(trip?.createdAt ?? d.createdAt);
        const dateText = `${dt.toISOString().slice(0, 10)} ${formatDate(dt)}`;
        map.set(tripId, {
          tripId,
          tripTitle: trip?.title ?? t('nav.items.trip'),
          orderNumber: trip?.orderNumber ?? null,
          search: [trip?.title, trip?.orderNumber, stopsText, dateText]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
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
  }, [docs, activeTrip?.id, t]);

  // Search by trip #, date or postcode (all folded into folder.search).
  const q = query.trim().toLowerCase();
  const filteredFolders = q
    ? folders.filter((f) => f.search.includes(q))
    : folders;

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
      Alert.alert(t('documents.uploadFailed'), (e as Error).message);
    }
  };

  const showUploadSheet = (tripId: string) => {
    Alert.alert(t('documents.uploadSheet.title'), t('documents.uploadSheet.subtitle'), [
      { text: t('documents.uploadSheet.camera'), onPress: () => pickAndUpload('camera', tripId) },
      { text: t('documents.uploadSheet.gallery'), onPress: () => pickAndUpload('gallery', tripId) },
      { text: t('documents.uploadSheet.file'), onPress: () => pickAndUpload('document', tripId) },
      { text: t('common.cancel'), style: 'cancel' },
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
          onPress={() => navigation.openDrawer()}
          hitSlop={8}
          style={({ pressed }) => [styles.menuBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="menu" size={24} color={c.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.foreground }]}>
          {t('nav.items.documents')}
        </Text>

        <NotificationBell colors={c} />
      </View>

      {!truckId ? (
        <ScreenPlaceholder
          icon="document-text-outline"
          title={t('truck.noTruck.title')}
          subtitle={t('documents.noTruck.subtitle')}
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
            title={t('documents.empty.title')}
            subtitle={
              activeTrip
                ? t('documents.empty.subtitleActive')
                : t('documents.empty.subtitleInactive')
            }
          />
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.searchWrap}>
            <View style={[styles.searchBox, { backgroundColor: c.muted }]}>
              <Ionicons name="search" size={16} color={c.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('documents.searchPlaceholder')}
                placeholderTextColor={c.mutedForeground}
                style={[styles.searchInput, { color: c.foreground }]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={c.mutedForeground} />
                </Pressable>
              )}
            </View>
          </View>
          {filteredFolders.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ color: c.mutedForeground }}>{t('common.noMatches')}</Text>
            </View>
          ) : (
            <FlatList
              data={filteredFolders}
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
        </View>
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
  const { t } = useTranslation();
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
              <Text style={styles.activePillText}>{t('documents.active')}</Text>
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
  const { t } = useTranslation();
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
      Alert.alert(t('documents.cannotOpen'), (e as Error).message);
    }
  };

  const handleDelete = (doc: DriverDocument) => {
    Alert.alert(
      t('documents.deleteConfirm.title'),
      t('documents.deleteConfirm.body', { name: doc.fileName }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => del.mutate(doc.id),
        },
      ],
    );
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
              <Text style={styles.uploadText}>{t('common.upload')}</Text>
            </Pressable>
          )}
        </View>

        {/* Tabs */}
        <View style={[styles.tabs, { borderBottomColor: c.border }]}>
          {(['ALL', 'PHOTO', 'DOCUMENT'] as Tab[]).map((tabKey) => {
            const active = tabKey === tab;
            const label =
              tabKey === 'ALL'
                ? t('documents.tabs.all')
                : tabKey === 'PHOTO'
                  ? t('documents.tabs.photos')
                  : t('documents.tabs.documents');
            return (
              <Pressable
                key={tabKey}
                onPress={() => setTab(tabKey)}
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
                  {label} ({counts[tabKey]})
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* List */}
        {filtered.length === 0 ? (
          <View style={styles.center}>
            <Text style={{ color: c.mutedForeground }}>{t('documents.nothingHere')}</Text>
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
  const created = formatDate(doc.createdAt, {
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
          {fullName(doc.uploader) ? ` · ${fullName(doc.uploader)}` : ''}
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

  // Search
  searchWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 38,
    borderRadius: Radius.md,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },

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
