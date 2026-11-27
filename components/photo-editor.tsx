import { Ionicons } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  type LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import {
  type Corner,
  dragCorner,
  dragRect,
  fitBox,
  type Rect,
  rotatedBounds,
  type Size,
  toFractions,
  totalRotation,
} from '@/lib/photo-crop-math';
import { type PhotoEdit, renderEdit, usePhotoEditStore } from '@/lib/photo-edit';

/*
 * Full-screen crop / rotate / straighten editor shown between picking photos
 * and sending them (lib/photo-edit → editPhotos). Mount <PhotoEditorHost />
 * once in the app layout. Same file in is-driver and is-manager.
 *
 * Order for the user: level the shot with the slider (the crop resets when the
 * angle changes), then drag the corners to cut away what isn't needed.
 */

const MAX_STRAIGHTEN = 15;
const HANDLE = 44; // touch target of a corner
const SLIDER_H = 36;
const IDENTITY_CROP: Rect = { x: 0, y: 0, w: 1, h: 1 };

const identity = (): PhotoEdit => ({ quarterTurns: 0, straighten: 0, crop: IDENTITY_CROP });

export function PhotoEditorHost() {
  const request = usePhotoEditStore((s) => s.request);
  if (!request) return null;
  return <EditorModal key={request.assets.map((a) => a.uri).join('|')} assets={request.assets} resolve={request.resolve} />;
}

function EditorModal({
  assets,
  resolve,
}: {
  assets: ImagePickerAsset[];
  resolve: (r: ImagePickerAsset[] | null) => void;
}) {
  const finish = (result: ImagePickerAsset[] | null) => {
    usePhotoEditStore.setState({ request: null });
    resolve(result);
  };
  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={() => finish(null)}>
      <SafeAreaProvider>
        <Editor assets={assets} onFinish={finish} />
      </SafeAreaProvider>
    </Modal>
  );
}

function Editor({
  assets,
  onFinish,
}: {
  assets: ImagePickerAsset[];
  onFinish: (r: ImagePickerAsset[] | null) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [edits, setEdits] = useState<PhotoEdit[]>(() => assets.map(identity));
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  const [measured, setMeasured] = useState<Record<number, Size>>({});
  const [busy, setBusy] = useState(false);

  const asset = assets[index];
  const edit = edits[index];

  // Some pickers report 0×0 — read the real size once.
  useEffect(() => {
    if (asset.width > 0 && asset.height > 0) return;
    Image.getSize(
      asset.uri,
      (w, h) => setMeasured((m) => ({ ...m, [index]: { w, h } })),
      () => {},
    );
  }, [asset, index]);
  const natural: Size =
    asset.width > 0 && asset.height > 0
      ? { w: asset.width, h: asset.height }
      : (measured[index] ?? { w: 1000, h: 1000 });

  const deg = totalRotation(edit.quarterTurns, edit.straighten);
  const bounds = rotatedBounds(natural.w, natural.h, deg);
  const box = fitBox(bounds, { w: Math.max(view.w - 2 * Spacing.md, 0), h: Math.max(view.h - 2 * Spacing.md, 0) });
  const scale = bounds.w > 0 ? box.w / bounds.w : 0;
  const rect: Rect = {
    x: edit.crop.x * box.w,
    y: edit.crop.y * box.h,
    w: edit.crop.w * box.w,
    h: edit.crop.h * box.h,
  };

  const patch = (change: Partial<PhotoEdit>) =>
    setEdits((all) => all.map((e, i) => (i === index ? { ...e, ...change } : e)));

  // Latest geometry for the (created-once) drag handlers.
  const live = useRef({ box, crop: edit.crop, index });
  useEffect(() => {
    live.current = { box, crop: edit.crop, index };
  });
  const startRect = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  // eslint-disable-next-line react-hooks/refs -- the handlers read these refs only from touch events, never while rendering
  const [responders] = useState(() => {
    const make = (kind: Corner | 'move') =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const { box: b, crop } = live.current;
          startRect.current = { x: crop.x * b.w, y: crop.y * b.h, w: crop.w * b.w, h: crop.h * b.h };
        },
        onPanResponderMove: (_e, g) => {
          const { box: b, index: i } = live.current;
          if (b.w <= 0 || b.h <= 0) return;
          const next =
            kind === 'move'
              ? dragRect(startRect.current, g.dx, g.dy, b)
              : dragCorner(startRect.current, kind, g.dx, g.dy, b);
          const crop = toFractions(next, b);
          setEdits((all) => all.map((e, n) => (n === i ? { ...e, crop } : e)));
        },
      });
    return { tl: make('tl'), tr: make('tr'), bl: make('bl'), br: make('br'), move: make('move') };
  });

  const rotate = () => patch({ quarterTurns: (edit.quarterTurns + 1) % 4, crop: IDENTITY_CROP });
  const setStraighten = (value: number) => {
    const v = Math.max(-MAX_STRAIGHTEN, Math.min(MAX_STRAIGHTEN, Math.round(value * 10) / 10));
    patch({ straighten: Math.abs(v) < 0.3 ? 0 : v, crop: IDENTITY_CROP });
  };

  const isLast = index === assets.length - 1;

  const apply = async (list: PhotoEdit[]) => {
    setBusy(true);
    try {
      const out: ImagePickerAsset[] = [];
      for (let i = 0; i < assets.length; i += 1) {
        try {
          out.push(await renderEdit(assets[i], list[i]));
        } catch {
          out.push(assets[i]); // never block a send over an edit
        }
      }
      onFinish(out);
    } finally {
      setBusy(false);
    }
  };

  const next = (list: PhotoEdit[]) => {
    if (isLast) void apply(list);
    else setIndex(index + 1);
  };

  const skip = () => {
    const list = edits.map((e, i) => (i === index ? identity() : e));
    setEdits(list);
    next(list);
  };

  const onStageLayout = (e: LayoutChangeEvent) =>
    setView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable onPress={() => onFinish(null)} hitSlop={12} disabled={busy} accessibilityLabel={t('common.cancel', 'Скасувати')}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.counter}>
          {assets.length > 1 ? `${index + 1} / ${assets.length}` : t('photoEditor.title', 'Редагувати фото')}
        </Text>
        <Pressable onPress={rotate} hitSlop={12} disabled={busy} accessibilityLabel={t('photoEditor.rotate', 'Повернути')}>
          <Ionicons name="refresh" size={24} color="#fff" style={{ transform: [{ scaleX: -1 }] }} />
        </Pressable>
      </View>

      <View style={styles.stage} onLayout={onStageLayout}>
        {box.w > 0 && (
          <View style={{ width: box.w, height: box.h, overflow: 'hidden', backgroundColor: '#111' }}>
            <Image
              source={{ uri: asset.uri }}
              resizeMode="stretch"
              style={{
                position: 'absolute',
                width: natural.w * scale,
                height: natural.h * scale,
                left: (box.w - natural.w * scale) / 2,
                top: (box.h - natural.h * scale) / 2,
                transform: [{ rotate: `${deg}deg` }],
              }}
            />
            {/* Dim everything outside the crop. */}
            <View pointerEvents="none" style={[styles.dim, { left: 0, top: 0, right: 0, height: rect.y }]} />
            <View pointerEvents="none" style={[styles.dim, { left: 0, top: rect.y + rect.h, right: 0, bottom: 0 }]} />
            <View pointerEvents="none" style={[styles.dim, { left: 0, top: rect.y, width: rect.x, height: rect.h }]} />
            <View pointerEvents="none" style={[styles.dim, { left: rect.x + rect.w, top: rect.y, right: 0, height: rect.h }]} />

            {/* Crop frame: drag inside to move, drag a corner to resize. */}
            <View
              {...responders.move.panHandlers}
              style={[styles.frame, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}
            >
              <View pointerEvents="none" style={[styles.gridV, { left: '33.33%' }]} />
              <View pointerEvents="none" style={[styles.gridV, { left: '66.66%' }]} />
              <View pointerEvents="none" style={[styles.gridH, { top: '33.33%' }]} />
              <View pointerEvents="none" style={[styles.gridH, { top: '66.66%' }]} />
            </View>
            {(['tl', 'tr', 'bl', 'br'] as Corner[]).map((c) => (
              <View
                key={c}
                {...responders[c].panHandlers}
                style={[
                  styles.handle,
                  {
                    left: (c === 'tl' || c === 'bl' ? rect.x : rect.x + rect.w) - HANDLE / 2,
                    top: (c === 'tl' || c === 'tr' ? rect.y : rect.y + rect.h) - HANDLE / 2,
                  },
                ]}
              >
                <View style={styles.handleDot} />
              </View>
            ))}
          </View>
        )}
      </View>

      <Text style={styles.hint}>{t('photoEditor.hint', 'Вирівняйте фото, потім потягніть кути, щоб обрізати')}</Text>

      <AngleSlider value={edit.straighten} onChange={setStraighten} disabled={busy} label={t('photoEditor.straighten', 'Вирівняти')} />

      <View style={styles.footer}>
        <Pressable onPress={skip} disabled={busy} style={[styles.btn, styles.btnGhost]}>
          <Text style={styles.btnGhostText}>{t('photoEditor.skip', 'Без змін')}</Text>
        </Pressable>
        <Pressable onPress={() => next(edits)} disabled={busy} style={[styles.btn, styles.btnPrimary]}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnPrimaryText}>
              {isLast ? t('photoEditor.done', 'Надіслати') : t('photoEditor.next', 'Далі')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** Horizontal slider −15°…+15° built on PanResponder (no slider package here). */
function AngleSlider({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [width, setWidth] = useState(0);
  const latest = useRef({ value, width, onChange });
  useEffect(() => {
    latest.current = { value, width, onChange };
  });
  const startValue = useRef(0);

  // eslint-disable-next-line react-hooks/refs -- the handlers read these refs only from touch events, never while rendering
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startValue.current = latest.current.value;
      },
      onPanResponderMove: (_e, g) => {
        const { width: w, onChange: change } = latest.current;
        if (w <= 0) return;
        change(startValue.current + (g.dx / w) * 2 * MAX_STRAIGHTEN);
      },
    }),
  );

  const thumbX = width > 0 ? ((value + MAX_STRAIGHTEN) / (2 * MAX_STRAIGHTEN)) * width : 0;
  return (
    <View style={[styles.sliderRow, disabled && { opacity: 0.5 }]} pointerEvents={disabled ? 'none' : 'auto'}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <View style={styles.sliderTrackWrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
        <View style={styles.sliderTrack} />
        <View style={[styles.sliderCenter, { left: width / 2 - 1 }]} />
        <View style={[styles.sliderThumb, { left: thumbX - 14 }]} />
      </View>
      <Pressable onPress={() => onChange(0)} hitSlop={8}>
        <Text style={styles.sliderValue}>{`${value > 0 ? '+' : ''}${value.toFixed(1)}°`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, height: 48 },
  counter: { color: '#fff', fontSize: 15, fontWeight: '600' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: { position: 'absolute', borderWidth: 1.5, borderColor: '#fff' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center' },
  handleDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', borderWidth: 2, borderColor: '#3B6EE0' },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, height: SLIDER_H + 12 },
  sliderLabel: { color: '#fff', fontSize: 13, width: 78 },
  sliderTrackWrap: { flex: 1, height: SLIDER_H, justifyContent: 'center' },
  sliderTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  sliderCenter: { position: 'absolute', top: SLIDER_H / 2 - 7, width: 2, height: 14, backgroundColor: 'rgba(255,255,255,0.7)' },
  sliderThumb: { position: 'absolute', top: SLIDER_H / 2 - 14, width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', borderWidth: 3, borderColor: '#3B6EE0' },
  sliderValue: { color: '#fff', fontSize: 13, width: 56, textAlign: 'right' },
  footer: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.xs },
  btn: { flex: 1, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  btnGhostText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnPrimary: { backgroundColor: '#3B6EE0' },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
