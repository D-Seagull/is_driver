import type { TFunction } from 'i18next';

/**
 * What to tell the user when an upload is refused. The server answers 413
 * when a file is too large / too many at once, and 415 for a file type it
 * doesn't take (SVG, archives, executables…); everything else keeps the
 * error's own message.
 */
export function uploadErrorText(e: unknown, t: TFunction, fallback?: string): string {
  const status = (e as { response?: { status?: number } } | null)?.response?.status;
  if (status === 413) return t('documents.fileTooLarge');
  if (status === 415) return t('documents.fileTypeNotSupported');
  return fallback ?? (e as Error | null)?.message ?? '';
}
