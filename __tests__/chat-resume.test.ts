import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

type Handler = (...args: unknown[]) => void;
const mockSock = {
  connected: true,
  emit: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
  onAny: jest.fn(),
  io: { on: jest.fn(), engine: { on: jest.fn() } },
};
jest.mock('socket.io-client', () => ({ io: jest.fn(() => mockSock) }));

import { mergeById } from '@/lib/merge-by-id';
import { getSocket, probeSocketLiveness } from '@/lib/socket';

const m = (id: string, at: string, extra: object = {}) => ({ id, createdAt: at, ...extra });

describe('mergeById', () => {
  it('adds missed rows once, keeps older pages, fresh copy wins, sorted', () => {
    const prev = [m('a', '2026-01-01T10:00:00Z'), m('b', '2026-01-01T11:00:00Z', { isRead: false })];
    const fresh = [m('b', '2026-01-01T11:00:00Z', { isRead: true }), m('c', '2026-01-01T12:00:00Z')];
    const out = mergeById(prev, fresh);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(out[1]).toMatchObject({ isRead: true });
    expect(mergeById(out, fresh)).toHaveLength(3);
  });
});

describe('probeSocketLiveness', () => {
  let anyHandler: Handler | undefined;
  beforeEach(() => {
    jest.useFakeTimers();
    getSocket('t');
    anyHandler ??= mockSock.onAny.mock.calls[0]?.[0] as Handler | undefined;
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reconnects a zombie socket that does not answer', () => {
    jest.advanceTimersByTime(10);
    probeSocketLiveness();
    expect(mockSock.emit).toHaveBeenCalledWith('requestPresence');
    jest.advanceTimersByTime(2_600);
    expect(mockSock.disconnect).toHaveBeenCalledTimes(1);
    expect(mockSock.connect).toHaveBeenCalledTimes(1);
  });

  it('leaves a socket alone when the server answers', () => {
    jest.advanceTimersByTime(10);
    probeSocketLiveness();
    jest.advanceTimersByTime(500);
    expect(anyHandler).toBeDefined();
    anyHandler?.('presenceSnapshot');
    jest.advanceTimersByTime(2_600);
    expect(mockSock.disconnect).not.toHaveBeenCalled();
  });
});
