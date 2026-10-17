// eslint-disable-next-line no-restricted-imports -- type only — helper takes a FlatList ref
import type { FlatList } from 'react-native';

// Pages loaded at most while looking for a quoted message.
const MAX_PAGES = 30;

/** Resolves once `items()` returns a new array (the page rendered), or after `ms`. */
function waitForChange<T>(items: () => readonly T[], before: readonly T[], ms: number) {
  const started = Date.now();
  return new Promise<void>((resolve) => {
    const check = () => {
      if (items() !== before || Date.now() - started > ms) resolve();
      else setTimeout(check, 32);
    };
    check();
  });
}

/**
 * Finds a quoted message in a chat list and scrolls to it. When it's older
 * than what is loaded, older pages are fetched until it shows up — tapping a
 * quote of an old message used to do nothing.
 *
 * `items` must return the CURRENT list (read a ref), `loadOlder` resolves to
 * whether more history may exist. Resolves false when the message is gone
 * (deleted) or beyond MAX_PAGES.
 */
export async function revealInList<T>(opts: {
  items: () => readonly T[];
  matches: (item: T) => boolean;
  scrollTo: (index: number) => void;
  loadOlder?: () => Promise<boolean>;
}): Promise<boolean> {
  for (let page = 0; page <= MAX_PAGES; page++) {
    const index = opts.items().findIndex(opts.matches);
    if (index >= 0) {
      opts.scrollTo(index);
      return true;
    }
    if (!opts.loadOlder || page === MAX_PAGES) return false;
    const before = opts.items();
    const more = await opts.loadOlder();
    await waitForChange(opts.items, before, 1000);
    if (!more && opts.items().findIndex(opts.matches) < 0) return false;
  }
  return false;
}

/**
 * onScrollToIndexFailed for chat lists: a far item isn't measured yet, so
 * FlatList can't scroll to it. Jump near it by the average row height, then
 * retry once it has rendered. (A no-op handler made such jumps silently fail.)
 * `attempts` (a ref) caps the retries for one jump.
 */
export function retryScrollToIndex(
  list: FlatList | null,
  info: { index: number; averageItemLength: number },
  attempts: { current: number },
) {
  if (!list || attempts.current++ > 4) {
    attempts.current = 0;
    return;
  }
  list.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
  setTimeout(() => {
    list.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
  }, 120);
}
