/**
 * Trip status — mirrors `TripStatus` enum in is-fleet-backend/prisma/schema.prisma.
 * Keep in sync if the backend enum changes.
 */

export type TripStatus =
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'ON_WAY'
  | 'ON_SITE'
  | 'LOADED'
  | 'DELIVERED';

export const TRIP_STATUSES: TripStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_WAY',
  'ON_SITE',
  'LOADED',
  'DELIVERED',
];

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  ASSIGNED: 'Assigned',
  ACCEPTED: 'Accepted',
  ON_WAY: 'On Way',
  ON_SITE: 'On Site',
  LOADED: 'Loaded',
  DELIVERED: 'Delivered',
};

// Tailwind ~500/600 palette ported from web TRIP_STATUS_COLORS.
export const TRIP_STATUS_COLORS: Record<TripStatus, { bg: string; fg: string; border: string }> = {
  ASSIGNED: { bg: 'rgba(107,114,128,0.12)', fg: '#4B5563', border: 'rgba(107,114,128,0.3)' },
  ACCEPTED: { bg: 'rgba(59,130,246,0.12)', fg: '#2563EB', border: 'rgba(59,130,246,0.3)' },
  ON_WAY: { bg: 'rgba(234,179,8,0.15)', fg: '#A16207', border: 'rgba(234,179,8,0.35)' },
  ON_SITE: { bg: 'rgba(249,115,22,0.12)', fg: '#C2410C', border: 'rgba(249,115,22,0.3)' },
  LOADED: { bg: 'rgba(168,85,247,0.12)', fg: '#9333EA', border: 'rgba(168,85,247,0.3)' },
  DELIVERED: { bg: 'rgba(16,185,129,0.12)', fg: '#059669', border: 'rgba(16,185,129,0.3)' },
};
