/**
 * System chat messages (driver/manager reassigned, etc.) are persisted once
 * but shown to participants who may each use a different UI language. The
 * backend stores them as `[[sys]]{"k":"<key>","p":{...params}}` so every
 * client localizes them at render time. Legacy plain-text system messages
 * (no prefix) render exactly as stored.
 */
const PREFIX = '[[sys]]';

export function systemMessageText(
  content: string,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  if (!content.startsWith(PREFIX)) return content;
  try {
    const { k, p } = JSON.parse(content.slice(PREFIX.length)) as {
      k: string;
      p?: Record<string, unknown>;
    };
    return t(k, p ?? {});
  } catch {
    return content;
  }
}
