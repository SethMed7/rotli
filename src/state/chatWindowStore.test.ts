// The one routing rule panes.openChat asks while Chat lives in its own window.
// `mock.module` is process-wide and outlives this file, so the mock spreads the
// REAL module and afterAll puts it back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as liveBridge from "../lib/chatWindowBridge";

// a SNAPSHOT of the real exports: the namespace import is live, so after
// mock.module it points at the mocks and "restoring" it would re-install them
const realBridge = { ...liveBridge };

let sent: unknown[] = [];
let shown = 0;
void mock.module("../lib/chatWindowBridge", () => ({
  ...realBridge,
  sendChatWindow: (message: unknown) => sent.push(message),
  showChatWindow: async () => {
    shown += 1;
  },
}));
afterAll(() => {
  void mock.module("../lib/chatWindowBridge", () => realBridge);
});

const { chatWindowTakes, useChatWindowStore } = await import("./chatWindowStore");

beforeEach(() => {
  sent = [];
  shown = 0;
  useChatWindowStore.getState().setDetached(false);
});

describe("where a chat opens", () => {
  test("with Chat in main, nothing is routed anywhere", () => {
    expect(chatWindowTakes("plan", undefined)).toBe(false);
    expect(sent).toEqual([]);
    expect(shown).toBe(0);
  });

  test("with Chat pulled out, a chat opened in main opens THERE and the window comes forward", () => {
    useChatWindowStore.getState().setDetached(true);
    expect(chatWindowTakes("plan", "vault")).toBe(true);
    expect(sent).toEqual([{ kind: "open", refs: [{ slug: "plan", vaultId: "vault" }] }]);
    expect(shown).toBe(1);
  });

  test("a fresh chat goes there too", () => {
    useChatWindowStore.getState().setDetached(true);
    expect(chatWindowTakes(null, undefined)).toBe(true);
    expect(sent).toEqual([{ kind: "open", refs: [{ slug: null }] }]);
  });

  test("regrouping forgets what the window held", () => {
    const store = useChatWindowStore.getState();
    store.setDetached(true);
    store.setRefs([{ slug: "plan" }, { slug: "plan" }, { slug: null }]);
    expect(useChatWindowStore.getState().refs).toEqual([{ slug: "plan" }]);
    store.setDetached(false);
    expect(useChatWindowStore.getState().refs).toEqual([]);
  });
});
