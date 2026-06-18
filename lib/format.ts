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
