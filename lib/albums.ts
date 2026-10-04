/**
 * Albums: files sent in one message share a `batchId` (the backend sets it
 * when more than one file is uploaded at once). Chats draw such a group as
 * one bubble — a photo grid, the other files under it, the caption once.
 *
 * Same file in is-driver and is-manager — keep them in sync.
 */

interface AlbumDoc {
  id: string;
  batchId?: string | null;
  createdAt: string;
}

/**
 * Splits documents into display groups: every album becomes one group (its
 * files oldest first), every other document a group of its own. Groups keep
 * the order of their first file in `docs`.
 */
export function groupAlbums<T extends AlbumDoc>(docs: T[]): T[][] {
  const groups: T[][] = [];
  const byBatch = new Map<string, T[]>();
  for (const d of docs) {
    if (!d.batchId) {
      groups.push([d]);
      continue;
    }
    const album = byBatch.get(d.batchId);
    if (album) {
      album.push(d);
    } else {
      const fresh = [d];
      byBatch.set(d.batchId, fresh);
      groups.push(fresh);
    }
  }
  for (const album of byBatch.values()) {
    album.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    );
  }
  return groups;
}

/** Live (not deleted) file count per album — for "Album · N files" labels. */
export function albumSizes(
  docs: (AlbumDoc & { deletedAt?: string | null })[],
): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const d of docs) {
    if (d.batchId && !d.deletedAt) {
      sizes.set(d.batchId, (sizes.get(d.batchId) ?? 0) + 1);
    }
  }
  return sizes;
}
