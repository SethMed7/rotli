// The Chat window's half of the hand-off (review of #55). This webview is
// told it is the "chat" surface; the bridge is recorded. `mock.module` is
// process-wide and outlives this file, so each mock spreads a SNAPSHOT of the
// real module and afterAll puts that snapshot back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as liveBridge from "../lib/chatWindowBridge";
import * as liveStore from "./chatWindowStore";

const realBridge = { ...liveBridge };
const realStore = { ...liveStore };

let sent: Array<{ kind: string; refs?: Array<{ slug: string | null }> }> = [];
let hidden = 0;
let shown = 0;
let onMessage: ((message: { kind: string; refs?: unknown }) => void) | null = null;
let onClose: (() => void) | null = null;
let onShown: (() => void) | null = null;

void mock.module("../lib/chatWindowBridge", () => ({
  ...realBridge,
  sendChatWindow: (message: { kind: string }) => sent.push(message),
  onChatWindow: (cb: typeof onMessage) => {
    onMessage = cb;
    return () => {};
  },
  onChatWindowCloseRequest: (cb: () => void) => {
    onClose = cb;
    return () => {};
  },
  onChatWindowShown: (cb: () => void) => {
    onShown = cb;
    return () => {};
  },
  hideChatWindow: async () => {
    hidden += 1;
  },
  showChatWindow: async () => {
    shown += 1;
  },
}));
void mock.module("./chatWindowStore", () => ({ ...realStore, windowSurface: () => "chat" }));
afterAll(() => {
  // the chat-window side subscribes to the pane store: left attached, it would
  // keep closing every note tab in the test files that run after this one
  detach();
  void mock.module("../lib/chatWindowBridge", () => realBridge);
  void mock.module("./chatWindowStore", () => realStore);
});

const { REGROUP_BLOCKED, attachChatWindow } = await import("./chatWindow");
const { useChatRuns } = await import("./chatRuns");
const { leaves, resetPanesForVaultSwitch, usePanesStore } = await import("./panes");
const { useUiStore } = await import("./ui");

const chatSlugs = () =>
  leaves(usePanesStore.getState().root).flatMap((leaf) =>
    leaf.tabs.flatMap((tab) => (tab.surfaceKind === "chat" ? [tab.chatSlug] : [])),
  );

let detach: () => void = () => {};
beforeEach(() => {
  detach();
  sent = [];
  hidden = 0;
  shown = 0;
  useChatRuns.setState({ runs: {} });
  useUiStore.getState().setRowActionError(null);
  resetPanesForVaultSwitch();
  detach = attachChatWindow(
    () => {},
    () => {},
  );
});

describe("the Chat window", () => {
  test("its panes hold chats only — the note placeholder the store boots with is closed", () => {
    expect(leaves(usePanesStore.getState().root).flatMap((leaf) => leaf.tabs)).toEqual([]);
  });

  test("a chat handed over twice is ONE tab — two tabs on one file would fight over its revision", () => {
    onMessage?.({ kind: "open", refs: [{ slug: "plan" }] });
    onMessage?.({ kind: "open", refs: [{ slug: "plan" }] });
    expect(chatSlugs()).toEqual(["plan"]);
  });

  test("handing back sends the chats WITHOUT an interim empty report main could save", () => {
    onMessage?.({ kind: "open", refs: [{ slug: "plan" }, { slug: "budget" }] });
    sent = [];
    onClose?.();
    expect(sent).toEqual([{ kind: "regrouped", refs: [{ slug: "plan" }, { slug: "budget" }] }]);
    expect(chatSlugs()).toEqual([]);
    expect(hidden).toBe(1);
  });

  test("a chat still answering here cannot go back: the window stays, comes forward, and says why", () => {
    onMessage?.({ kind: "open", refs: [{ slug: "plan" }] });
    useChatRuns.setState({ runs: { "corpus:plan": "running" } });
    sent = [];
    onMessage?.({ kind: "regroup" });
    expect(sent).toEqual([]);
    expect(chatSlugs()).toEqual(["plan"]);
    expect(hidden).toBe(0);
    expect(shown).toBe(1);
    expect(useUiStore.getState().rowActionError).toBe(REGROUP_BLOCKED);
  });

  test("being shown before the handed-over chats open never reports an empty list", () => {
    sent = [];
    onShown?.();
    expect(sent).toEqual([]);
    onMessage?.({ kind: "open", refs: [{ slug: "plan" }] });
    expect(sent).toEqual([{ kind: "tabs", refs: [{ slug: "plan" }] }]);
    onShown?.();
    expect(sent.at(-1)).toEqual({ kind: "tabs", refs: [{ slug: "plan" }] });
  });
});
