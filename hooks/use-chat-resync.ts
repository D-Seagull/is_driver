import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { getSocket } from '@/lib/socket';

/** Back-to-back triggers (resume + the reconnect it causes) fetch once. */
const MIN_GAP_MS = 1_500;

/**
 * Runs `resync` whenever an open chat may have missed live events: the app
 * came back to the foreground (phone unlocked) or the socket reconnected.
 * Socket events are not replayed after a drop, so the open thread has to ask
 * the server for what it missed instead of waiting for the next reopen.
 */
export function useChatResync(resync: (() => void) | null): void {
  const fnRef = useRef(resync);
  useEffect(() => {
    fnRef.current = resync;
  }, [resync]);
  const enabled = resync !== null;

  useEffect(() => {
    if (!enabled) return;
    let lastAt = 0;
    const run = () => {
      const now = Date.now();
      if (now - lastAt < MIN_GAP_MS) return;
      lastAt = now;
      fnRef.current?.();
    };

    let prev = AppState.currentState;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (prev !== 'active' && next === 'active') run();
      prev = next;
    });

    // The first connect after mount comes with the initial history load;
    // every later one is a reconnect that may have missed messages.
    const sock = getSocket();
    let connectedBefore = sock.connected;
    const onConnect = () => {
      if (connectedBefore) run();
      connectedBefore = true;
    };
    sock.on('connect', onConnect);

    return () => {
      sub.remove();
      sock.off('connect', onConnect);
    };
  }, [enabled]);
}
