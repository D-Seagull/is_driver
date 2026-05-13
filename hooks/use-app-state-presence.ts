import { useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { getSocket } from '@/lib/socket';

/**
 * Tracks foreground/background and tells the server, so it knows when to
 * fall through to push notifications. The socket itself can survive a few
 * seconds of background on iOS, which would otherwise look "online".
 */
export function useAppStatePresence() {
  useEffect(() => {
    const emit = (state: AppStateStatus) => {
      const sock = getSocket();
      if (!sock.connected) return;
      if (state === 'active') sock.emit('appActive');
      else sock.emit('appBackground');
    };

    // Emit current state immediately so the server knows we're foreground
    // right after mount.
    emit(AppState.currentState);

    const sub = AppState.addEventListener('change', emit);

    // Also flip to active whenever the socket (re)connects — the server's
    // per-socket flag resets to true on connect, but if we reconnected while
    // backgrounded we want to be honest.
    const sock = getSocket();
    const onConnect = () => emit(AppState.currentState);
    sock.on('connect', onConnect);

    return () => {
      sub.remove();
      sock.off('connect', onConnect);
    };
  }, []);
}
