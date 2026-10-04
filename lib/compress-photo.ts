import type { ImagePickerAsset } from 'expo-image-picker';

/**
 * Photos are shrunk on the phone before upload — less mobile data for the
 * driver, a faster send. ONE encode at high quality: the picker hands over the
 * untouched shot (PICKER_QUALITY 1) and we resize it to PHOTO_MAX on the long
 * edge, JPEG 0.9. The server sees a JPEG within PHOTO_MAX and no EXIF and
 * keeps it as is, so a photographed CMR loses quality exactly once. Measured
 * on a real CMR: 1.9 MB → 1 MB with the small print unchanged.
 *
 * Same file in is-driver and is-manager — keep them in sync. PHOTO_MAX must
 * match the backend's (supabase-storage.service.ts).
 */
const PHOTO_MAX = 2560;
const QUALITY = 0.9;

type Manipulator = typeof import('expo-image-manipulator');

/**
 * expo-image-manipulator is native and only in builds made after it was
 * added — required lazily so an older build (reached by OTA) keeps working
 * and simply uploads the picker's photo as before.
 */
function loadManipulator(): Manipulator | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-manipulator') as Manipulator;
  } catch {
    return null;
  }
}

const manipulator = loadManipulator();

/**
 * `quality` for launchCameraAsync / launchImageLibraryAsync. 1 = no extra
 * encode in the picker when we compress ourselves; without the manipulator
 * the picker's 0.8 stays the only compression, as it always was.
 */
export const PICKER_QUALITY = manipulator ? 1 : 0.8;

export interface LocalUpload {
  uri: string;
  name: string;
  mimeType: string;
}

/** A picked photo, ready to upload — compressed when possible. */
export async function compressPhoto(asset: ImagePickerAsset): Promise<LocalUpload> {
  const original: LocalUpload = {
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? 'image/jpeg',
  };
  // GIFs would lose their animation.
  if (!manipulator || /gif/i.test(original.mimeType)) return original;

  try {
    const { ImageManipulator, SaveFormat } = manipulator;
    const ctx = ImageManipulator.manipulate(asset.uri);
    const longEdge = Math.max(asset.width, asset.height);
    if (longEdge > PHOTO_MAX) {
      ctx.resize(
        asset.width >= asset.height ? { width: PHOTO_MAX } : { height: PHOTO_MAX },
      );
    }
    const image = await ctx.renderAsync();
    const result = await image.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
    return {
      uri: result.uri,
      name: original.name.replace(/\.[^.]*$/, '') + '.jpg',
      mimeType: 'image/jpeg',
    };
  } catch {
    // Never block a send over this — the server optimises the original.
    return original;
  }
}

/** compressPhoto for every picked asset, a couple at a time (phone memory). */
export async function compressPhotos(assets: ImagePickerAsset[]): Promise<LocalUpload[]> {
  const out: LocalUpload[] = [];
  for (let i = 0; i < assets.length; i += 2) {
    out.push(...(await Promise.all(assets.slice(i, i + 2).map(compressPhoto))));
  }
  return out;
}
