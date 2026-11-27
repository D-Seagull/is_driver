import type { ImagePickerAsset } from 'expo-image-picker';
import { create } from 'zustand';

import { getManipulator } from '@/lib/compress-photo';
import { cropPixels, isIdentity, totalRotation, type Rect } from '@/lib/photo-crop-math';

/*
 * Crop / rotate / straighten step between picking a photo and sending it.
 * `editPhotos` opens the full-screen editor (components/photo-editor.tsx,
 * mounted once in the app layout) and resolves with the edited assets, or null
 * when the user cancels. Builds without expo-image-manipulator, GIFs and
 * non-images skip the editor and return the photos untouched.
 *
 * Same file in is-driver and is-manager — keep them in sync.
 */

interface EditRequest {
  assets: ImagePickerAsset[];
  resolve: (result: ImagePickerAsset[] | null) => void;
}

export const usePhotoEditStore = create<{ request: EditRequest | null }>(() => ({
  request: null,
}));

function editable(asset: ImagePickerAsset): boolean {
  const type = (asset.mimeType ?? '').toLowerCase();
  if (type.includes('gif')) return false;
  return type === '' || type.startsWith('image/');
}

/** Show the editor for the picked photos. null = the user cancelled. */
export function editPhotos(assets: ImagePickerAsset[]): Promise<ImagePickerAsset[] | null> {
  if (assets.length === 0 || !getManipulator() || !assets.some(editable)) {
    return Promise.resolve(assets);
  }
  return new Promise((resolve) => {
    // A second request while one is open would orphan the first.
    usePhotoEditStore.getState().request?.resolve(null);
    usePhotoEditStore.setState({ request: { assets, resolve } });
  });
}

export interface PhotoEdit {
  /** Quarter turns clockwise. */
  quarterTurns: number;
  /** Small extra angle in degrees, to level a crooked shot. */
  straighten: number;
  /** Crop as fractions of the rotated picture. */
  crop: Rect;
}

/**
 * Apply one photo's edits. Two passes — rotate (the result's real size is
 * read back, since a tilted picture grows), then crop — and a lossless-ish
 * JPEG (the send step compresses once more, see lib/compress-photo).
 */
export async function renderEdit(
  asset: ImagePickerAsset,
  edit: PhotoEdit,
): Promise<ImagePickerAsset> {
  const lib = getManipulator();
  if (!lib || isIdentity(edit.quarterTurns, edit.straighten, edit.crop)) return asset;
  const { ImageManipulator, SaveFormat } = lib;

  const rotation = totalRotation(edit.quarterTurns, edit.straighten);
  const first = ImageManipulator.manipulate(asset.uri);
  if (Math.abs(rotation) > 0.01) first.rotate(rotation);
  const rotated = await (await first.renderAsync()).saveAsync({
    compress: 1,
    format: SaveFormat.JPEG,
  });

  const box = cropPixels(edit.crop, rotated.width, rotated.height);
  const full = box.width >= rotated.width && box.height >= rotated.height;
  if (full) {
    return { ...asset, uri: rotated.uri, width: rotated.width, height: rotated.height, mimeType: 'image/jpeg' };
  }
  const second = ImageManipulator.manipulate(rotated.uri);
  second.crop(box);
  const out = await (await second.renderAsync()).saveAsync({
    compress: 1,
    format: SaveFormat.JPEG,
  });
  return { ...asset, uri: out.uri, width: out.width, height: out.height, mimeType: 'image/jpeg' };
}
