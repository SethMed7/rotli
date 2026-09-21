// Pulling Chat out, from main's side: what moves, what it carries, and the one
// thing that blocks it. `mock.module` is process-wide and outlives this file,
// so the mock spreads the REAL module and afterAll puts it back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import * as liveBridge from "../lib/chatWindowBridge";

// a SNAPSHOT of the real exports: the namespace import is live, so after
// mock.module it points at the mocks and "restoring" it would re-install them
const realBridge = { ...liveBridge };

let sent: Array<{ kind: string; refs?: unknown }> = [];
let shown = 0;
void mock.module("../lib/chatWindowBridge", () => ({
  ...realBridge,
  sendChatWindow: (message: { kind: string }) => sent.push(message),
  showChatWindow: async () => {
    shown += 1;
  },
}));
afterAll(() => {
  void mock.module("../lib/chatWindowBridge", () => realBridge);
});

const { POP_OUT_BLOCKED, popOutBlocker, popOutChat } = await import("./chatWindow");
const { useChatDrafts } = await import("./chatDrafts");
const { useChatRuns } = await import("./chatRuns");
const { useChatWindowStore } = await import("./chatWindowStore");
const { leaves, resetPanesForVaultSwitch, usePanesStore } = await import("./panes");

const chatTabs = () =>
  leaves(usePanesStore.getState().root).flatMap((leaf) =>
    leaf.tabs.filter((tab) => tab.surfaceKind === "chat"),
  );

beforeEach(() => {
  sent = [];
  shown = 0;
  useChatWindowStore.getState().setDetached(false);
  useChatRuns.setState({ runs: {} });
  useChatDrafts.setState({ drafts: {} });
  resetPanesForVaultSwitch();
});

describe("pulling Chat out of main", () => {
  test("the chat tabs leave main with their unsent text; notes stay; the window is shown", () => {
    const panes = usePanesStore.getState();
    panes.openChat("plan", { newTab: true });
    panes.openChat("budget", { newTab: true });
    const budget = chatTabs().find((tab) => tab.surfaceKind === "chat" && tab.chatSlug === "budget");
    useChatDrafts.getState().setMessage(budget?.id ?? "", "half a thought");
    const notesBefore = leaves(usePanesStore.getState().root).flatMap((leaf) => leaf.tabs).length - 2;

    expect(popOutChat()).toBeNull();

    expect(chatTabs()).toEqual([]);
    expect(leaves(usePanesStore.getState().root).flatMap((leaf) => leaf.tabs)).toHaveLength(notesBefore);
    expect(sent).toEqual([
      { kind: "open", refs: [{ slug: "plan" }, { slug: "budget", draft: "half a thought" }] },
    ]);
    expect(shown).toBe(1);
    expect(useChatWindowStore.getState()).toMatchObject({
      detached: true,
      refs: [{ slug: "plan" }, { slug: "budget" }],
    });
    // the draft went with its chat — it is not left behind under a dead tab id
    expect(useChatDrafts.getState().drafts).toEqual({});
    // moved, not closed: ⌘⇧T must not bring a second copy back into main
    expect(usePanesStore.getState().closedTabs).toEqual([]);
  });

  test("with no chat open, the window starts on a fresh one rather than empty", () => {
    expect(popOutChat()).toBeNull();
    expect(sent).toEqual([{ kind: "open", refs: [{ slug: null }] }]);
  });

  test("a chat that is still answering blocks it, in plain words, and nothing moves", () => {
    usePanesStore.getState().openChat("plan", { newTab: true });
    useChatRuns.setState({ runs: { "corpus:plan": "running" } });
    expect(popOutBlocker()).toBe(POP_OUT_BLOCKED);
    expect(popOutChat()).toBe(POP_OUT_BLOCKED);
    expect(chatTabs()).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(useChatWindowStore.getState().detached).toBe(false);
    // a finished or unread chat does not block
    useChatRuns.setState({ runs: { "corpus:plan": "unread" } });
    expect(popOutBlocker()).toBeNull();
  });
});
