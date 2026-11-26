/** One chat, the way its message pushes name it (see the backend's `data`). */
export type ChatRef =
  | { tripId: string }
  | { userId: string }
  | { groupId: string };

/** Is this push payload a message of that chat? */
export function isPushForChat(
  data: Record<string, unknown> | undefined,
  ref: ChatRef,
): boolean {
  if (!data) return false;
  if ('tripId' in ref) return data.type === 'MESSAGE' && data.tripId === ref.tripId;
  if ('userId' in ref) return data.type === 'DM_MESSAGE' && data.userId === ref.userId;
  return data.type === 'GROUP_MESSAGE' && data.groupId === ref.groupId;
}

/**
 * Android tray tag of a chat — the same strings the backend sets on its
 * message pushes (`chatTag` in push/chat-tag.ts). A DM is tagged with the
 * other person's id. One tray entry per chat; cleared by this tag.
 */
export function chatTag(ref: ChatRef): string {
  if ('tripId' in ref) return `trip:${ref.tripId}`;
  if ('userId' in ref) return `dm:${ref.userId}`;
  return `group:${ref.groupId}`;
}

/** The chat tag a message push's data stands for, or null for other news. */
function tagOfData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null;
  const id = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : null);
  if (data.type === 'MESSAGE' && id('tripId')) return `trip:${id('tripId')}`;
  if (data.type === 'DM_MESSAGE' && id('userId')) return `dm:${id('userId')}`;
  if (data.type === 'GROUP_MESSAGE' && id('groupId')) return `group:${id('groupId')}`;
  return null;
}

/**
 * Which chat a notification in the tray belongs to. Two shapes:
 *  - drawn by the system (FCM, app in background / closed — the usual case):
 *    no data at all, but the identifier carries the push's tag —
 *    `expo-notifications://foreign_notifications?tag=dm%3Au1&id=0`;
 *  - drawn by the app itself (expo-notifications): the push's data is there.
 */
export function trayChatTag(
  identifier: string,
  data: Record<string, unknown> | undefined,
): string | null {
  const m = /[?&]tag=([^&]*)/.exec(identifier);
  if (m) {
    try {
      const tag = decodeURIComponent(m[1].replace(/\+/g, ' '));
      if (/^(trip|dm|group):/.test(tag)) return tag;
    } catch {
      // malformed — fall through to the data
    }
  }
  return tagOfData(data);
}

/**
 * The tag of a silent "chat read" push (`{type:'CHAT_READ', tag}`), from any
 * of the shapes it reaches JS in: a notification's data, or the background
 * task payload (Android: JSON in `data.dataString`; iOS: in `data.body`).
 */
export function chatReadTag(payload: unknown): string | null {
  const pick = (d: unknown): string | null => {
    if (!d || typeof d !== 'object') return null;
    const o = d as Record<string, unknown>;
    if (o.type === 'CHAT_READ' && typeof o.tag === 'string') return o.tag;
    for (const k of ['dataString', 'body']) {
      const v = o[k];
      if (typeof v === 'string') {
        try {
          const r = pick(JSON.parse(v));
          if (r) return r;
        } catch {
          // not JSON
        }
      } else if (v && typeof v === 'object') {
        const r = pick(v);
        if (r) return r;
      }
    }
    return null;
  };
  if (!payload || typeof payload !== 'object') return null;
  return pick(payload) ?? pick((payload as Record<string, unknown>).data);
}
