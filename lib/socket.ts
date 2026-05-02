import { io, Socket } from 'socket.io-client';

import { API_URL } from './config';

let socket: Socket | null = null;

export function getSocket(token?: string): Socket {
  if (!socket) {
    console.log('[socket] creating → ', API_URL, 'token:', token ? token.slice(0, 20) + '…' : 'NONE');

    socket = io(API_URL, {
      query: { userId: token ?? '' },
      // polling first → upgrades to WebSocket automatically.
      // This avoids Android WebSocket handshake failures.
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      timeout: 10000,
    });

    socket.on('connect', () =>
      console.log('[socket] ✅ connected id=', socket?.id, 'transport=', socket?.io.engine.transport.name),
    );
    socket.on('disconnect', (r) => console.log('[socket] ❌ disconnected reason=', r));
    socket.on('connect_error', (e) => console.warn('[socket] ⚠️ error=', e.message));
    socket.io.on('upgrade', (t) => console.log('[socket] ⬆️ upgraded to', t.name));
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('[socket] disconnected & cleared');
  }
}
