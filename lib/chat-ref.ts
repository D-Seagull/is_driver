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
