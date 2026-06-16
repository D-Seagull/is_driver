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
