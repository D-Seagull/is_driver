import AsyncStorage from '@react-native-async-storage/async-storage';

// Diagnostics that ride along with a bug report (BugReport.logs, shown
// collapsed to admins) — no USB / adb needed. The latest lines are kept on
// the device across restarts, so the report carries what happened before it
// even when the app was closed in between. Also mirrored to console (logcat
// `ReactNativeJS`). Today the trip-question queue writes here (PushNoticeOverlay).

const KEY = 'diag-log';
const MAX_LINES = 400;
const SAVE_DELAY_MS = 2000;

let lines: string[] = [];
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Earlier sessions' lines go in front of whatever this one logged meanwhile.
const loaded = AsyncStorage.getItem(KEY)
  .then((raw) => {
    const saved: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(saved)) {
      lines = [...saved.filter((x) => typeof x === 'string'), ...lines].slice(-MAX_LINES);
    }
  })
  .catch(() => {});

const stamp = () => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void AsyncStorage.setItem(KEY, JSON.stringify(lines)).catch(() => {});
  }, SAVE_DELAY_MS);
}

export function diagLog(...args: unknown[]) {
  const text = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  console.log('[diag]', text);
  lines.push(`${stamp()} ${text}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  scheduleSave();
}

/** The newest lines that fit in `budget` characters, oldest first. */
export async function diagTail(budget: number): Promise<string> {
  await loaded;
  const out: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = lines[i].length + 1;
    if (used + len > budget) break;
    out.unshift(lines[i]);
    used += len;
  }
  return out.join('\n');
}
