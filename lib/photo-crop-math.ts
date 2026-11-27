/*
 * Geometry of the photo editor (components/photo-editor.tsx), kept free of
 * React so it can be unit-tested. Same file in is-driver and is-manager.
 *
 * Model: the photo is rotated by `deg` (quarter turns + a small straighten
 * angle) and then cropped. The crop is edited on screen as a rectangle inside
 * the rotated photo's bounding box, and sent to the image library as
 * fractions (0..1) of that box, so it does not depend on screen size.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box of a w×h picture rotated by `deg` degrees. */
export function rotatedBounds(w: number, h: number, deg: number): Size {
  const r = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  return { w: w * c + h * s, h: w * s + h * c };
}

/** Largest box with the aspect of `box` that fits inside `view`. */
export function fitBox(box: Size, view: Size): Size {
  if (box.w <= 0 || box.h <= 0 || view.w <= 0 || view.h <= 0) return { w: 0, h: 0 };
  const k = Math.min(view.w / box.w, view.h / box.h);
  return { w: box.w * k, h: box.h * k };
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Smallest crop side, in screen pixels — keeps the handles reachable. */
export const MIN_CROP = 48;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Drag a corner by (dx, dy) from the rect it had when the drag started. */
export function dragCorner(start: Rect, corner: Corner, dx: number, dy: number, box: Size): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (corner === 'tl' || corner === 'bl') left = clamp(left + dx, 0, right - MIN_CROP);
  if (corner === 'tr' || corner === 'br') right = clamp(right + dx, left + MIN_CROP, box.w);
  if (corner === 'tl' || corner === 'tr') top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (corner === 'bl' || corner === 'br') bottom = clamp(bottom + dy, top + MIN_CROP, box.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Move the whole rect by (dx, dy), staying inside the box. */
export function dragRect(start: Rect, dx: number, dy: number, box: Size): Rect {
  return {
    x: clamp(start.x + dx, 0, box.w - start.w),
    y: clamp(start.y + dy, 0, box.h - start.h),
    w: start.w,
    h: start.h,
  };
}

/** Crop rect as fractions of the box. */
export function toFractions(rect: Rect, box: Size): Rect {
  if (box.w <= 0 || box.h <= 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: rect.x / box.w, y: rect.y / box.h, w: rect.w / box.w, h: rect.h / box.h };
}

/** True when the fractions cover (almost) the whole picture. */
export function isFullCrop(f: Rect, eps = 0.005): boolean {
  return f.x <= eps && f.y <= eps && f.w >= 1 - eps && f.h >= 1 - eps;
}

/** Fractions → whole pixels of a W×H bitmap, never outside it. */
export function cropPixels(f: Rect, W: number, H: number) {
  const originX = clamp(Math.round(f.x * W), 0, Math.max(W - 1, 0));
  const originY = clamp(Math.round(f.y * H), 0, Math.max(H - 1, 0));
  const width = clamp(Math.round(f.w * W), 1, W - originX);
  const height = clamp(Math.round(f.h * H), 1, H - originY);
  return { originX, originY, width, height };
}

/** Quarter turns (0..3) and the straighten angle → one rotation in degrees. */
export function totalRotation(quarterTurns: number, straighten: number): number {
  return ((((quarterTurns % 4) + 4) % 4) * 90 + straighten) % 360;
}

/** True when the edits change nothing (the original can be used as is). */
export function isIdentity(quarterTurns: number, straighten: number, f: Rect): boolean {
  return ((quarterTurns % 4) + 4) % 4 === 0 && Math.abs(straighten) < 0.05 && isFullCrop(f);
}
