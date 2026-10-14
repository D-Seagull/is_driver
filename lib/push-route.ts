import { router } from 'expo-router';

type Payload = Record<string, unknown> | undefined;

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/**
 * A tap on a chat-message push opens that chat and points it at the message
 * (`messageId` param → the screen scrolls to it and flashes it).
 * Returns false for any other push.
 *
 * The current trip is the Trip tab itself (no `tripId`) — same as the bell
 * does; another trip opens as its own screen.
 */
export function openChatFromPush(data: Payload, activeTripId?: string): boolean {
  const messageId = str(data?.messageId);
  switch (data?.type) {
    case 'MESSAGE': {
      const tripId = str(data?.tripId);
      if (!tripId) return false;
      if (tripId === activeTripId) {
        router.navigate({ pathname: '/(driver)/trip', params: { messageId } });
      } else {
        router.push({ pathname: '/(driver)/trip', params: { tripId, messageId } });
      }
      return true;
    }
    case 'DM_MESSAGE': {
      const userId = str(data?.userId);
      if (!userId) return false;
      router.push({ pathname: '/(driver)/dm/[userId]', params: { userId, messageId } });
      return true;
    }
    case 'GROUP_MESSAGE': {
      const groupId = str(data?.groupId);
      if (!groupId) return false;
      router.push({ pathname: '/(driver)/group/[groupId]', params: { groupId, messageId } });
      return true;
    }
    default:
      return false;
  }
}
