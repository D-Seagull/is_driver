/**
 * Composes a display name from firstName + lastName, handling nulls so the
 * caller never has to. Drops empty parts and trims surrounding whitespace.
 *
 *   fullName({ firstName: 'Dmytro', lastName: 'Chaika' }) // "Dmytro Chaika"
 *   fullName({ firstName: 'Vasia',  lastName: null     }) // "Vasia"
 *   fullName(null)                                        // ""
 */
export function fullName(
  user: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string {
  if (!user) return '';
  return [user.firstName, user.lastName]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .trim();
}

/**
 * Formats a stop's scheduled window for display, e.g. "14.08 · 08:00–10:00".
 * Returns "" when there's no meaningful time (both ends unset or 00:00), so
 * stops without a planned window render nothing. Mirrors the web helper.
 */
export function formatStopWindow(stop: {
  windowDate?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}): string {
  const start = stop.windowStart && stop.windowStart !== '00:00' ? stop.windowStart : '';
  const endRaw = stop.windowEnd && stop.windowEnd !== '00:00' ? stop.windowEnd : '';
  const end = endRaw && endRaw !== start ? endRaw : '';
  if (!start && !end) return '';
  const time = [start, end].filter(Boolean).join('–');
  const [, m, d] = (stop.windowDate ?? '').split('-');
  const date = m && d ? `${d}.${m}` : '';
  return date ? `${date} · ${time}` : time;
}

/**
 * Two-letter avatar fallback: first letter of firstName + first letter of
 * lastName. Falls back to a single letter when there is no lastName, then
 * to the email's first character, then to "?".
 *
 *   initials({ firstName: 'Dmytro', lastName: 'Chaika' })       // "DC"
 *   initials({ firstName: 'Vasia',  lastName: null     })       // "V"
 *   initials({ firstName: null, lastName: null, email: 'a@b' }) // "A"
 *   initials(null)                                              // "?"
 */
export function initials(
  user:
    | {
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
): string {
  if (!user) return '?';
  const f = (user.firstName ?? '').trim();
  const l = (user.lastName ?? '').trim();
  const combined = (f.charAt(0) + l.charAt(0)).toUpperCase();
  if (combined) return combined;
  const email = (user.email ?? '').trim();
  return email.charAt(0).toUpperCase() || '?';
}
