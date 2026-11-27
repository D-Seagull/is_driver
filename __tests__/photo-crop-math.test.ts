import { describe, expect, it } from '@jest/globals';
import {
  cropPixels,
  dragCorner,
  dragRect,
  fitBox,
  isFullCrop,
  isIdentity,
  MIN_CROP,
  rotatedBounds,
  toFractions,
  totalRotation,
} from '../lib/photo-crop-math';

const box = { w: 300, h: 200 };

describe('rotatedBounds', () => {
  it('swaps the sides on a quarter turn', () => {
    const b = rotatedBounds(400, 300, 90);
    expect(b.w).toBeCloseTo(300);
    expect(b.h).toBeCloseTo(400);
  });
  it('grows a little when tilted', () => {
    const b = rotatedBounds(400, 300, 5);
    expect(b.w).toBeGreaterThan(400);
    expect(b.h).toBeGreaterThan(300);
  });
});

describe('fitBox', () => {
  it('fits by the tighter side and keeps the aspect', () => {
    const f = fitBox({ w: 400, h: 300 }, { w: 200, h: 300 });
    expect(f.w).toBeCloseTo(200);
    expect(f.h).toBeCloseTo(150);
  });
  it('is empty without room', () => {
    expect(fitBox({ w: 400, h: 300 }, { w: 0, h: 300 })).toEqual({ w: 0, h: 0 });
  });
});

describe('dragCorner', () => {
  const full = { x: 0, y: 0, w: 300, h: 200 };
  it('moves the top-left corner in', () => {
    expect(dragCorner(full, 'tl', 40, 30, box)).toEqual({ x: 40, y: 30, w: 260, h: 170 });
  });
  it('never leaves the box', () => {
    const r = dragCorner(full, 'br', 500, 500, box);
    expect(r).toEqual(full);
    const l = dragCorner(full, 'tl', -50, -50, box);
    expect(l).toEqual(full);
  });
  it('keeps a minimum size', () => {
    const r = dragCorner(full, 'tl', 1000, 1000, box);
    expect(r.w).toBe(MIN_CROP);
    expect(r.h).toBe(MIN_CROP);
  });
});

describe('dragRect', () => {
  it('moves inside the box only', () => {
    const r = { x: 10, y: 10, w: 100, h: 80 };
    expect(dragRect(r, 1000, 1000, box)).toEqual({ x: 200, y: 120, w: 100, h: 80 });
    expect(dragRect(r, -1000, -1000, box)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });
});

describe('fractions and pixels', () => {
  it('round-trips a rect', () => {
    const f = toFractions({ x: 30, y: 20, w: 150, h: 100 }, box);
    expect(f).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(cropPixels(f, 2000, 1000)).toEqual({ originX: 200, originY: 100, width: 1000, height: 500 });
  });
  it('stays inside the bitmap', () => {
    const p = cropPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100);
    expect(p.originX + p.width).toBeLessThanOrEqual(100);
    expect(p.originY + p.height).toBeLessThanOrEqual(100);
    expect(p.width).toBeGreaterThanOrEqual(1);
  });
});

describe('identity', () => {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  it('detects an unedited photo', () => {
    expect(isFullCrop(full)).toBe(true);
    expect(isIdentity(0, 0, full)).toBe(true);
    expect(isIdentity(4, 0, full)).toBe(true);
    expect(isIdentity(1, 0, full)).toBe(false);
    expect(isIdentity(0, 2, full)).toBe(false);
    expect(isIdentity(0, 0, { x: 0.1, y: 0, w: 0.9, h: 1 })).toBe(false);
  });
  it('adds quarter turns and the tilt', () => {
    expect(totalRotation(1, 3.5)).toBeCloseTo(93.5);
    expect(totalRotation(-1, 0)).toBe(270);
  });
});
