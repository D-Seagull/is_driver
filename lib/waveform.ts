/**
 * Loudness bars of a voice message. Stored on the server as a string of
 * comma-separated values 0–100 ("12,40,33,…"), one per bar.
 */

export const WAVEFORM_BARS = 40;

/** Microphone level (dBFS, ≈ −160…0) → 0…1. Speech sits around −50…−10 dB. */
export function dbToLevel(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 55) / 55));
}

/**
 * Levels sampled while recording (0…1 each) → `bars` values 0–100: the
 * recording is cut into equal slices, each slice shows its average, and the
 * result is stretched so the loudest bar is full height (quiet recordings
 * stay readable). Null when there is too little to draw.
 */
export function buildWaveform(levels: number[], bars = WAVEFORM_BARS): number[] | null {
  if (levels.length < 8) return null;
  const slice = levels.length / bars;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * slice);
    const to = Math.max(from + 1, Math.floor((i + 1) * slice));
    let sum = 0;
    for (let j = from; j < to && j < levels.length; j++) sum += levels[j];
    out.push(sum / (to - from));
  }
  const peak = Math.max(...out, 0.05);
  return out.map((v) => Math.round(Math.min(100, Math.max(4, (v / peak) * 100))));
}

/** The form-field value the server expects. */
export function waveformToString(bars: number[] | null): string | null {
  return bars ? bars.join(',') : null;
}

/** Bars from the server string; null when missing (old messages). */
export function parseWaveform(raw?: string | null): number[] | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length < 8 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.map((n) => Math.min(100, Math.max(0, n)));
}

/** A calm, even pattern for messages recorded before waveforms existed. */
export function placeholderWaveform(bars = WAVEFORM_BARS): number[] {
  return Array.from({ length: bars }, (_, i) => 28 + Math.round(14 * Math.sin(i * 0.9)));
}
