import { describe, expect, it } from '@jest/globals';
import {
  buildWaveform,
  dbToLevel,
  parseWaveform,
  placeholderWaveform,
  waveformToString,
} from '../lib/waveform';

describe('dbToLevel', () => {
  it('maps silence to 0 and full scale to 1', () => {
    expect(dbToLevel(-160)).toBe(0);
    expect(dbToLevel(-55)).toBe(0);
    expect(dbToLevel(0)).toBe(1);
    expect(dbToLevel(-27.5)).toBeCloseTo(0.5);
  });
  it('treats junk as silence', () => {
    expect(dbToLevel(NaN)).toBe(0);
    expect(dbToLevel(-Infinity)).toBe(0);
  });
});

describe('buildWaveform', () => {
  it('gives null when there is too little to draw', () => {
    expect(buildWaveform([0.5, 0.5, 0.5])).toBeNull();
  });

  it('gives the requested number of bars, 4–100 each', () => {
    const levels = Array.from({ length: 300 }, (_, i) => (i % 10) / 10);
    const bars = buildWaveform(levels, 40)!;
    expect(bars).toHaveLength(40);
    expect(Math.min(...bars)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...bars)).toBe(100);
  });

  it('stretches a quiet recording so it stays readable', () => {
    const bars = buildWaveform(Array(100).fill(0.1), 10)!;
    expect(Math.max(...bars)).toBe(100);
  });

  it('follows the loud and quiet parts in order', () => {
    const levels = [...Array(50).fill(0.05), ...Array(50).fill(0.9)];
    const bars = buildWaveform(levels, 10)!;
    expect(bars[0]).toBeLessThan(bars[9]);
  });

  it('works with fewer samples than bars', () => {
    expect(buildWaveform(Array(10).fill(0.4), 40)).toHaveLength(40);
  });
});

describe('waveform string', () => {
  it('round-trips', () => {
    const bars = [1, 20, 55, 100, 3, 8, 9, 40];
    expect(parseWaveform(waveformToString(bars))).toEqual(bars);
  });
  it('gives null for missing or malformed input', () => {
    expect(parseWaveform(null)).toBeNull();
    expect(parseWaveform('')).toBeNull();
    expect(parseWaveform('1,2,3')).toBeNull();
    expect(parseWaveform('1,2,3,4,5,6,7,x')).toBeNull();
    expect(waveformToString(null)).toBeNull();
  });
  it('has a placeholder with the right size', () => {
    expect(placeholderWaveform(32)).toHaveLength(32);
  });
});
