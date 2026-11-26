import { describe, expect, it } from '@jest/globals';
import { chatReadTag, chatTag, isPushForChat, trayChatTag } from '../lib/chat-ref';

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

describe("chatTag / trayChatTag", () => {
  it("builds the backend's tags", () => {
    expect(chatTag({ tripId: "t1" })).toBe("trip:t1");
    expect(chatTag({ userId: "u1" })).toBe("dm:u1");
    expect(chatTag({ groupId: "g1" })).toBe("group:g1");
  });

  it("reads the tag of a system-drawn (FCM) entry from its identifier", () => {
    const id = "expo-notifications://foreign_notifications?tag=dm%3Au1&id=0";
    expect(trayChatTag(id, { "android.title": "Ivan" })).toBe("dm:u1");
  });

  it("ignores foreign tags that aren't ours", () => {
    const id = "expo-notifications://foreign_notifications?tag=FCM-Notification%3A123&id=0";
    expect(trayChatTag(id, undefined)).toBeNull();
  });

  it("falls back to the data of an entry the app drew itself", () => {
    expect(trayChatTag("0:1700000000%abc", { type: "GROUP_MESSAGE", groupId: "g1" })).toBe("group:g1");
    // Other news never maps to a chat.
    expect(trayChatTag("x", { type: "NEW_TRIP", tripId: "t1" })).toBeNull();
  });
});

describe("chatReadTag", () => {
  it("reads notification data", () => {
    expect(chatReadTag({ type: "CHAT_READ", tag: "dm:u1" })).toBe("dm:u1");
  });

  it("reads the Android background-task payload (JSON in dataString)", () => {
    const payload = {
      data: { dataString: JSON.stringify({ type: "CHAT_READ", tag: "trip:t1" }) },
      notification: null,
    };
    expect(chatReadTag(payload)).toBe("trip:t1");
  });

  it("reads the iOS background payload (JSON in body)", () => {
    const payload = { data: { body: JSON.stringify({ type: "CHAT_READ", tag: "group:g1" }) } };
    expect(chatReadTag(payload)).toBe("group:g1");
  });

  it("is null for any other push", () => {
    expect(chatReadTag({ type: "DM_MESSAGE", userId: "u1" })).toBeNull();
    expect(chatReadTag(null)).toBeNull();
  });
});
