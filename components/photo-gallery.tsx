import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
// FlatList from gesture-handler, not react-native: on Android a plain
// ScrollView pager gets its touches cancelled by the photos' pinch / tap
// handlers, so swiping did nothing there (iOS was fine). This one takes part
// in gesture-handler's arbitration and swipes alongside them.
import {
  FlatList,
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Spacing } from '@/constants/theme';

export interface GalleryPhoto {
  id: string;
  uri: string;
  /** Small preview (already cached from the chat) — shown instantly while the
   *  full photo loads. Absent for photos uploaded before previews existed. */
  thumbUri?: string | null;
  /** Original name — keeps the right extension when saving / sharing. */
  fileName?: string;
}

type MediaLibraryLegacy = typeof import('expo-media-library/legacy');

/**
 * expo-media-library, loaded only when "Save" is tapped and never at import
 * time: its default ("Next") entry needs a native module Expo Go doesn't ship,
 * and a top-level import crashed the whole app on start. The `legacy` entry
 * (native `ExpoMediaLibrary`) exists in Expo Go and in our builds. null →
 * not available here; "Save" then explains instead of crashing.
 */
function loadMediaLibrary(): MediaLibraryLegacy | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-media-library/legacy') as MediaLibraryLegacy;
  } catch {
    return null;
  }
}

/**
 * The photo as a local file (cache), downloaded once per photo — save and
 * share both need a file on the device, not a URL.
 */
async function toLocalFile(photo: GalleryPhoto): Promise<File> {
  const name = (photo.fileName || `${photo.id}.jpg`).replace(/[\\/:*?"<>|]/g, '_');
  const file = new File(Paths.cache, `gallery-${photo.id}-${name}`);
  if (file.exists) return file;
  return File.downloadFileAsync(photo.uri, file);
}

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

/**
 * Full-screen photo gallery: every photo of a chat, opened at the one tapped.
 * Swipe sideways to flip; pinch or double-tap to zoom (towards the fingers);
 * drag a zoomed photo around — flipping pauses while zoomed. ✕ or Android
 * back closes. Visible while `startIndex` isn't null.
 *
 * Same file in is-driver and is-manager — keep them in sync.
 */
export function PhotoGallery({
  photos,
  startIndex,
  onClose,
}: {
  photos: GalleryPhoto[];
  startIndex: number | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(startIndex ?? 0);
  const [zoomed, setZoomed] = useState(false);
  const open = startIndex !== null && photos.length > 0;

  // Re-opening on another photo starts there (adjusted during render —
  // React's "store the previous prop" pattern, no extra effect pass).
  const [prevStart, setPrevStart] = useState(startIndex);
  if (startIndex !== prevStart) {
    setPrevStart(startIndex);
    if (startIndex !== null) {
      setIndex(startIndex);
      setZoomed(false);
    }
  }

  const renderItem = useCallback(
    ({ item }: { item: GalleryPhoto }) => (
      <ZoomablePhoto
        uri={item.uri}
        thumbUri={item.thumbUri}
        width={width}
        height={height}
        onZoomChange={setZoomed}
      />
    ),
    [width, height],
  );

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* A Modal is its own native root — gestures need their own root view. */}
      <GestureHandlerRootView style={styles.root}>
        {open && (
          <FlatList
            // Remount per opening so initialScrollIndex applies again.
            key={`gallery-${startIndex}`}
            data={photos}
            keyExtractor={(p) => p.id}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(startIndex ?? 0, photos.length - 1)}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) =>
              setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
            }
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
          />
        )}

        {/* A Modal is a separate native window on Android: insets read from the
            app's provider are 0 there, so the controls slid under the status
            bar. Its own provider measures this window. */}
        <SafeAreaProvider style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <GalleryControls
            counter={`${Math.min(index, photos.length - 1) + 1} / ${photos.length}`}
            photo={photos[Math.min(index, photos.length - 1)]}
            onClose={onClose}
          />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * Counter + ✕ on top, Save / Share at the bottom — kept clear of the status
 * bar, notch and gesture bar.
 */
function GalleryControls({
  counter,
  photo,
  onClose,
}: {
  counter: string;
  photo: GalleryPhoto | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Which action is running, and the photo last saved (shows "Saved ✓").
  const [busy, setBusy] = useState<'save' | 'share' | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const save = async () => {
    if (!photo || busy) return;
    setBusy('save');
    try {
      const MediaLibrary = loadMediaLibrary();
      if (!MediaLibrary) {
        Alert.alert(t('gallery.saveFailed', 'Не вдалося зберегти фото'));
        return;
      }
      // Write-only: adding a photo doesn't need access to the whole library.
      const perm = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!perm.granted) {
        Alert.alert(
          t('gallery.permissionTitle', 'Немає доступу до галереї'),
          t('gallery.permissionBody', 'Дозвольте збереження фото в налаштуваннях телефона.'),
        );
        return;
      }
      const file = await toLocalFile(photo);
      await MediaLibrary.saveToLibraryAsync(file.uri);
      setSavedId(photo.id);
    } catch (e) {
      Alert.alert(t('gallery.saveFailed', 'Не вдалося зберегти фото'), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (!photo || busy) return;
    setBusy('share');
    try {
      const file = await toLocalFile(photo);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { dialogTitle: photo.fileName });
      }
    } catch (e) {
      Alert.alert(t('gallery.shareFailed', 'Не вдалося поділитися фото'), (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saved = !!photo && savedId === photo.id;
  // Belt and braces for Android: never above the status bar's own height.
  const top =
    Platform.OS === 'android'
      ? Math.max(insets.top, StatusBar.currentHeight ?? 0)
      : insets.top;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* White status-bar icons on the black backdrop. */}
      <StatusBar barStyle="light-content" />
      <Text style={[styles.counter, { top: top + Spacing.md }]}>{counter}</Text>
      <Pressable
        onPress={onClose}
        hitSlop={12}
        style={[styles.close, { top: top + Spacing.sm }]}
        accessibilityLabel="close"
      >
        <Ionicons name="close" size={30} color="#fff" />
      </Pressable>

      <View style={[styles.actions, { bottom: insets.bottom + Spacing.lg }]}>
        <Pressable
          onPress={save}
          disabled={!!busy || saved}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
        >
          {busy === 'save' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name={saved ? 'checkmark' : 'download-outline'} size={20} color="#fff" />
          )}
          <Text style={styles.actionText}>
            {saved ? t('gallery.saved', 'Збережено') : t('gallery.save', 'Зберегти')}
          </Text>
        </Pressable>
        <Pressable
          onPress={share}
          disabled={!!busy}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
        >
          {busy === 'share' ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="share-outline" size={20} color="#fff" />
          )}
          <Text style={styles.actionText}>{t('gallery.share', 'Поділитися')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One page: pinch / double-tap zoom towards the fingers, pan while zoomed.
 * Transform is `translate(x, y) scale(s)` around the photo's centre, so
 * keeping a point p (relative to the centre) fixed while zooming s → s' is
 *   x' = p − s' · (p − x) / s
 * Pan is only enabled while zoomed — at 1× the horizontal swipe belongs to
 * the gallery's pager.
 */
function ZoomablePhoto({
  uri,
  thumbUri,
  width,
  height,
  onZoomChange,
}: {
  uri: string;
  thumbUri?: string | null;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  // Values at gesture start.
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const reportZoom = useCallback(
    (z: boolean) => {
      setZoomed(z);
      onZoomChange(z);
    },
    [onZoomChange],
  );

  const clampTo = (s: number) => {
    'worklet';
    const maxX = (width * (s - 1)) / 2;
    const maxY = (height * (s - 1)) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, tx.value)),
      y: Math.min(maxY, Math.max(-maxY, ty.value)),
    };
  };

  const settle = () => {
    'worklet';
    if (scale.value <= 1.01) {
      scale.value = withTiming(1);
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      scheduleOnRN(reportZoom, false);
      return;
    }
    const c = clampTo(scale.value);
    tx.value = withTiming(c.x);
    ty.value = withTiming(c.y);
    scheduleOnRN(reportZoom, true);
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      const s = Math.min(MAX_SCALE, Math.max(1, startScale.value * e.scale));
      const px = e.focalX - width / 2;
      const py = e.focalY - height / 2;
      tx.value = px - (s * (px - startX.value)) / startScale.value;
      ty.value = py - (s * (py - startY.value)) / startScale.value;
      scale.value = s;
    })
    .onEnd(settle);

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .averageTouches(true)
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
    })
    .onEnd(settle);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        scheduleOnRN(reportZoom, false);
        return;
      }
      const s = DOUBLE_TAP_SCALE;
      const px = e.x - width / 2;
      const py = e.y - height / 2;
      const maxX = (width * (s - 1)) / 2;
      const maxY = (height * (s - 1)) / 2;
      scale.value = withTiming(s);
      tx.value = withTiming(Math.min(maxX, Math.max(-maxX, px - s * px)));
      ty.value = withTiming(Math.min(maxY, Math.max(-maxY, py - s * py)));
      scheduleOnRN(reportZoom, true);
    });

  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
          {/* Same box and fit for preview and photo, so nothing jumps when the
              full one fades in over it. */}
          <Image
            source={{ uri }}
            placeholder={thumbUri ? { uri: thumbUri } : undefined}
            placeholderContentFit="contain"
            transition={150}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  counter: {
    position: 'absolute',
    left: Spacing.lg,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
  },
  close: { position: 'absolute', right: Spacing.lg },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
