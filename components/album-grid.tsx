import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

export interface AlbumPhoto {
  id: string;
  /** Preview when there is one, else the full photo. */
  uri: string;
}

// Tiles shown at most; the last one carries "+N" for the rest.
const MAX_TILES = 4;
const WIDTH = 240;
const GAP = 2;
const HALF = (WIDTH - GAP) / 2;

/**
 * Photo grid of an album bubble (Telegram / Viber style):
 *   1 → the photo alone · 2 → side by side · 3 → one tall + two stacked ·
 *   4+ → 2×2, the 4th tile dimmed with "+N" for the photos not shown.
 * Every tile — "+N" included — opens the gallery at that photo; a long
 * press anywhere opens the album's actions.
 *
 * Same file in is-driver and is-manager — keep them in sync.
 */
export function AlbumGrid({
  photos,
  onOpen,
  onLongPress,
}: {
  photos: AlbumPhoto[];
  onOpen: (id: string) => void;
  onLongPress?: () => void;
}) {
  if (photos.length === 0) return null;

  const tile = (p: AlbumPhoto, width: number, height: number, more = 0) => (
    <Pressable
      key={p.id}
      onPress={() => onOpen(p.id)}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={{ width, height }}
    >
      <Image source={{ uri: p.uri }} style={styles.img} />
      {more > 0 && (
        <View style={styles.more}>
          <Text style={styles.moreText}>+{more}</Text>
        </View>
      )}
    </Pressable>
  );

  if (photos.length === 1) {
    return tile(photos[0], WIDTH, WIDTH * 0.75);
  }

  if (photos.length === 2) {
    return (
      <View style={styles.row}>
        {photos.map((p) => tile(p, HALF, 160))}
      </View>
    );
  }

  if (photos.length === 3) {
    return (
      <View style={styles.row}>
        {tile(photos[0], HALF, WIDTH)}
        <View style={styles.col}>
          {tile(photos[1], HALF, HALF)}
          {tile(photos[2], HALF, HALF)}
        </View>
      </View>
    );
  }

  const hidden = photos.length - MAX_TILES;
  const [a, b, c, d] = photos;
  return (
    <View style={styles.col}>
      <View style={styles.row}>
        {tile(a, HALF, HALF)}
        {tile(b, HALF, HALF)}
      </View>
      <View style={styles.row}>
        {tile(c, HALF, HALF)}
        {tile(d, HALF, HALF, hidden)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP },
  col: { flexDirection: 'column', gap: GAP },
  img: { width: '100%', height: '100%', backgroundColor: 'rgba(127,127,127,0.15)' },
  more: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { color: '#fff', fontSize: 22, fontWeight: '600' },
});
