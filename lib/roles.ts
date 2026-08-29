import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Chat role badge icon. Team leads get a shield to set them apart from plain
 * managers (headphones); drivers get a person. Mirrors the web chat, which
 * marks team leads with a shield too. Keep this the single source of truth so
 * every chat surface renders the same marker for a given role.
 */
export function roleBadgeIcon(role?: string | null): IoniconName {
  if (role === 'TEAMLEAD') return 'shield-outline';
  if (role === 'DRIVER') return 'person-outline';
  return 'headset-outline';
}
