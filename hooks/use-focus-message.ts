import { router } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * Opened from a push (`messageId` route param): once that message is in the
 * list, jump to it and flash it — via the screen's own quote-jump
 * (`reveal`). It may not be there on the first render: back from the
 * background the chat first catches up on what it missed, so this waits for
 * `items` to contain it rather than searching older history.
 */
export function useFocusMessage<T>(
  messageId: string | undefined,
  items: readonly T[],
  matches: (item: T, id: string) => boolean,
  reveal: (id: string) => void,
) {
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!messageId || handled.current === messageId) return;
    if (!items.some((it) => matches(it, messageId))) return;
    handled.current = messageId;
    // Let the list lay the new rows out first; then drop the param so a
    // later visit to this screen doesn't jump again.
    setTimeout(() => {
      reveal(messageId);
      router.setParams({ messageId: undefined });
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, items]);
}
