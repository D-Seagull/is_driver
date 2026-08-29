import { io, Socket } from 'socket.io-client';

import { API_URL } from './config';

let socket: Socket | null = null;

// ─── Liveness tracking ────────────────────────────────────────────────────
// Mobile sockets can freeze while the app sits open in the foreground:
// `socket.connected` stays true but the transport is dead, so no events (not
// even the server's ping) arrive. We stamp every received engine packet and
// let a foreground watchdog force a reconnect when the stream goes quiet.
let lastActivityAt = Date.now();

/** Ms since the last received packet (any event OR a server ping/pong). */
export function socketQuietMs(): number {
  return Date.now() - lastActivityAt;
}

function trackEngineActivity(s: Socket) {
  const stamp = () => {
    lastActivityAt = Date.now();
  };
  // The engine is recreated on every (re)connect, so (re)attach on each open.
  const attach = () => s.io.engine?.on('packet', stamp);
  attach();
  s.io.on('open', attach);
  // App-level events also count as activity.
  s.onAny(stamp);
}

/**
 * Force a fresh connection when the socket is dead or frozen. Safe to call
 * often — it only acts when the socket isn't genuinely live.
 */
export function ensureSocketAlive(): void {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
    return;
  }
  if (socketQuietMs() > 40_000) {
    lastActivityAt = Date.now(); // avoid a tight reconnect loop
    s.disconnect();
    s.connect();
  }
}

// Injected from the auth store (avoids a socket ↔ store circular import — the
// same pattern as configureApiAuth). Returns the current in-memory access token.
type TokenProvider = () => string | null | Promise<string | null>;
let getAuthToken: TokenProvider = () => null;
export function configureSocketAuth(fn: TokenProvider) {
  getAuthToken = fn;
}

export function getSocket(token?: string): Socket {
  if (!socket) {
    console.log('[socket] creating → ', API_URL, 'token:', token ? token.slice(0, 20) + '…' : 'NONE');

    socket = io(API_URL, {
      // Function form → fresh token on every (re)connect (a silent refresh may
      // have rotated it since login). Falls back to the token passed at
      // creation for the very first connect. Gateway reads handshake.auth.token.
      // Async so we can silently refresh an expired token before the handshake
      // (function form → runs on every reconnect). Falls back to the creation
      // token if the provider throws.
      auth: (cb) => {
        Promise.resolve(getAuthToken())
          .then((tok) => cb({ token: tok ?? token ?? '' }))
          .catch(() => cb({ token: token ?? '' }));
      },
      // polling first → upgrades to WebSocket automatically.
      // This avoids Android WebSocket handshake failures.
      transports: ['polling', 'websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1500,
      timeout: 10000,
    });

    trackEngineActivity(socket);

    socket.on('connect', () => {
      lastActivityAt = Date.now();
      console.log('[socket] ✅ connected id=', socket?.id, 'transport=', socket?.io.engine.transport.name);
    });
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
