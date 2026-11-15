import { describe, it, expect, jest } from '@jest/globals';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

import { configureSocketReauth, handleSocketDisconnect } from '@/lib/socket';

describe('socket dropped by the server', () => {
  it('re-auths only on a server-side drop, and not in a tight loop', async () => {
    const reauth = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
    configureSocketReauth(reauth);

    // Network blips reconnect on their own — no refresh needed.
    handleSocketDisconnect('transport close');
    handleSocketDisconnect('ping timeout');
    expect(reauth).not.toHaveBeenCalled();

    // The server rejected the handshake token → refresh + reconnect.
    handleSocketDisconnect('io server disconnect');
    expect(reauth).toHaveBeenCalledTimes(1);

    // A second drop right away (still bad token) doesn't hammer refresh.
    handleSocketDisconnect('io server disconnect');
    expect(reauth).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });
});
