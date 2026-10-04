import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

/**
 * Opening an attachment (PDF, Word, …) from a signed URL.
 *
 * iOS: the in-app Safari view renders PDFs and Office files itself.
 * Android: Chrome can't show a PDF inside a page — the in-app browser just
 * downloaded it silently or showed nothing. So the file is downloaded to the
 * cache and handed to the system "Open with…" (Google PDF Viewer, Drive,
 * Adobe…). That needs expo-intent-launcher in the build; without it (older
 * builds reached by OTA) the share sheet is the fallback, which also lists
 * the viewers.
 *
 * Same file in is-driver and is-manager — keep them in sync.
 */

type IntentLauncher = typeof import('expo-intent-launcher');

function loadIntentLauncher(): IntentLauncher | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-intent-launcher') as IntentLauncher;
  } catch {
    return null;
  }
}

// Intent.FLAG_GRANT_READ_URI_PERMISSION — lets the viewer read our file.
const GRANT_READ = 1;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
};

function mimeOf(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? '*/*';
}

/** The file in the cache, downloaded once per document id. */
async function toLocalFile(id: string, url: string, fileName: string): Promise<File> {
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '_');
  const file = new File(Paths.cache, `doc-${id}-${safe}`);
  if (file.exists) return file;
  return File.downloadFileAsync(url, file);
}

export async function openRemoteFile(doc: {
  id: string;
  signedUrl: string;
  fileName: string;
}): Promise<void> {
  if (Platform.OS !== 'android') {
    await WebBrowser.openBrowserAsync(doc.signedUrl);
    return;
  }

  // Logged step by step: on a phone this is the only trace of where it stops.
  const file = await toLocalFile(doc.id, doc.signedUrl, doc.fileName);
  const type = mimeOf(doc.fileName);
  const launcher = loadIntentLauncher();
  const contentUri = file.contentUri;
  console.log('[open-file]', doc.fileName, {
    size: file.size,
    type,
    launcher: !!launcher,
    contentUri,
  });
  if (launcher && contentUri) {
    try {
      await launcher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type,
        flags: GRANT_READ,
      });
      return;
    } catch (e) {
      // No app for this type — fall through to the share sheet.
      console.warn('[open-file] no viewer, sharing instead', e);
    }
  }
  await Sharing.shareAsync(file.uri, { mimeType: type, dialogTitle: doc.fileName });
}

/**
 * Android's document picker can hand back URL-encoded names
 * ("Wynagrodzenie%20za%207.pdf") — store the readable one.
 */
export function readableFileName(name: string): string {
  try {
    return /%[0-9a-f]{2}/i.test(name) ? decodeURIComponent(name) : name;
  } catch {
    return name;
  }
}
