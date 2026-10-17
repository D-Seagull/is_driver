import type { TFunction } from 'i18next';

import { formatStopWindow } from '@/lib/format';
import { Trip } from '@/lib/types';

/**
 * Body of the "accept this trip" question: order no · title, where and when
 * to load, the truck. Shared by every place that asks it, so the driver reads
 * the same thing whichever way the question reached them.
 */
export function tripAskBody(trip: Trip, t: TFunction): string {
  const loadingStop = trip.stops?.find((s) => s.type === 'LOADING');
  const loadingAddress = loadingStop?.address?.trim();
  const loadingWindow = loadingStop ? formatStopWindow(loadingStop) : '';
  return [
    trip.orderNumber ? `#${trip.orderNumber} · ${trip.title}` : trip.title,
    loadingAddress
      ? t('trip.nextAssigned.loadingAt', { address: loadingAddress }) +
        (loadingWindow ? ` · ${loadingWindow}` : '')
      : loadingWindow || null,
    trip.truck?.plate ?? null,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface TripAsk {
  tripId: string;
  title: string;
  body: string;
  /** Open the trip once the driver taps OK. */
  openOnAccept?: boolean;
}

type Listener = (ask: TripAsk) => void;
const listeners = new Set<Listener>();

/**
 * Hand an "accept this trip" question to PushNoticeOverlay. It keeps ONE
 * queue with one dedupe for every trip question — the push, the in-app
 * notice, the data catch-up and the next-trip hand-off used to be separate
 * windows and could ask about the same trip twice.
 */
export function askAcceptTrip(ask: TripAsk) {
  for (const l of listeners) l(ask);
}

export function onAcceptTripAsk(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
