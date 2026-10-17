import { describe, expect, it } from '@jest/globals';
import { isPushForChat } from '../lib/chat-ref';

describe("isPushForChat", () => {
  it("matches a trip chat message by tripId", () => {
    expect(isPushForChat({ type: "MESSAGE", tripId: "t1", messageId: "m" }, { tripId: "t1" })).toBe(true);
    expect(isPushForChat({ type: "MESSAGE", tripId: "t2" }, { tripId: "t1" })).toBe(false);
  });

  it("matches a DM by its sender (the peer whose chat is open)", () => {
    expect(isPushForChat({ type: "DM_MESSAGE", userId: "u1" }, { userId: "u1" })).toBe(true);
    expect(isPushForChat({ type: "DM_MESSAGE", userId: "u2" }, { userId: "u1" })).toBe(false);
  });

  it("matches a group message by groupId", () => {
    expect(isPushForChat({ type: "GROUP_MESSAGE", groupId: "g1" }, { groupId: "g1" })).toBe(true);
  });

  it("never clears other kinds of news, even with the same id", () => {
    // A new-trip banner carries tripId too — opening that trip chat must not eat it.
    expect(isPushForChat({ type: "NEW_TRIP", tripId: "t1" }, { tripId: "t1" })).toBe(false);
    expect(isPushForChat({ type: "ALARM", tripId: "t1" }, { tripId: "t1" })).toBe(false);
    expect(isPushForChat(undefined, { tripId: "t1" })).toBe(false);
  });
});
