/**
 * Merges a freshly fetched page of chat rows into what the cache already holds:
 * one row per id (the fresh copy wins — it carries edits, deletes, ✓✓ and
 * reactions the socket may have missed), older pages the user scrolled to are
 * kept, and the result stays oldest → newest.
 */
export function mergeById<T extends { id: string; createdAt: string }>(
  prev: T[] | undefined,
  fresh: T[],
): T[] {
  if (!prev || prev.length === 0) return fresh;
  if (fresh.length === 0) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  fresh.forEach((m) => byId.set(m.id, { ...byId.get(m.id), ...m }));
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}
