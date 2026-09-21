import { describe, expect, test } from "bun:test";

import type { LeafNode, PaneNode, Tab } from "../types";
import {
  type DraftOf,
  movableChatTabs,
  savedChatRefs,
  uniqueChatRefs,
  withDetachedChats,
} from "./chatWindowTabs";

const chat = (id: string, slug: string | null, vaultId?: string): Tab => ({
  id,
  surfaceKind: "chat",
  chatSlug: slug,
  ...(vaultId ? { vaultId } : {}),
});
const note = (id: string): Tab => ({ id, surfaceKind: "note", noteId: `n-${id}` }) as Tab;
const leaf = (id: string, tabs: Tab[]): LeafNode => ({
  kind: "leaf",
  id,
  tabs,
  activeTabId: tabs[0]?.id ?? "",
});
const split = (children: PaneNode[]): PaneNode =>
  ({
    kind: "split",
    id: "s",
    dir: "row",
    sizes: children.map(() => 1 / children.length),
    children,
  }) as PaneNode;

const noDrafts: DraftOf = () => ({ message: "", images: 0 });

describe("which chats move to the Chat window", () => {
  test("every chat tab, across panes, in tab order — saved or fresh — and nothing else", () => {
    const root = split([
      leaf("a", [note("1"), chat("2", "plan"), chat("3", null)]),
      leaf("b", [chat("4", "budget", "vault")]),
    ]);
    expect(movableChatTabs(root, noDrafts)).toEqual([
      { paneId: "a", tabId: "2", ref: { slug: "plan" } },
      { paneId: "a", tabId: "3", ref: { slug: null } },
      { paneId: "b", tabId: "4", ref: { slug: "budget", vaultId: "vault" } },
    ]);
  });

  test("unsent text rides along — each window keeps its drafts in its own memory", () => {
    const drafts: DraftOf = (tabId) => ({ message: tabId === "2" ? "half a thought" : "  ", images: 0 });
    const moved = movableChatTabs(leaf("a", [chat("2", "plan"), chat("3", "budget")]), drafts);
    expect(moved.map((entry) => entry.ref)).toEqual([
      { slug: "plan", draft: "half a thought" },
      { slug: "budget" },
    ]);
  });

  test("a tab holding draft IMAGES stays put (they cannot cross webviews) — unless the window is closing", () => {
    const root = leaf("a", [chat("2", "plan"), chat("3", "budget")]);
    const drafts: DraftOf = (tabId) => ({ message: "", images: tabId === "2" ? 1 : 0 });
    expect(movableChatTabs(root, drafts).map((entry) => entry.tabId)).toEqual(["3"]);
    expect(movableChatTabs(root, drafts, true).map((entry) => entry.tabId)).toEqual(["2", "3"]);
  });

  test("only SAVED chats are recorded in main's layout", () => {
    expect(savedChatRefs(leaf("a", [chat("1", null), chat("2", "plan")]))).toEqual([{ slug: "plan" }]);
  });

  test("a chat is one reference however many times it is reported", () => {
    expect(
      uniqueChatRefs([
        { slug: "plan" },
        { slug: "plan", vaultId: "vault" },
        { slug: "budget" },
        { slug: null },
      ]),
    ).toEqual([{ slug: "plan" }, { slug: "budget" }]);
  });
});

describe("the saved layout while Chat lives in its own window", () => {
  test("the chat window's chats are written as ordinary tabs of main's first pane", () => {
    const root = split([leaf("a", [note("1")]), leaf("b", [note("2")])]);
    const saved = withDetachedChats(root, [{ slug: "plan" }, { slug: "budget", vaultId: "vault" }]);
    const first = (saved as { children: LeafNode[] }).children[0];
    expect(first?.tabs.map((tab) => (tab.surfaceKind === "chat" ? tab.chatSlug : tab.id))).toEqual([
      "1",
      "plan",
      "budget",
    ]);
    expect(first?.activeTabId).toBe("1");
    // the live tree is never touched
    expect((root as { children: LeafNode[] }).children[0]?.tabs).toHaveLength(1);
  });

  test("a chat main already shows is not doubled, and nothing detached changes nothing", () => {
    const root = leaf("a", [chat("1", "plan")]);
    expect(withDetachedChats(root, [{ slug: "plan" }])).toBe(root);
    expect(withDetachedChats(root, [])).toBe(root);
  });

  test("an empty main pane takes the chats and gets an active tab", () => {
    const saved = withDetachedChats(leaf("a", []), [{ slug: "plan" }]) as LeafNode;
    expect(saved.tabs).toHaveLength(1);
    expect(saved.activeTabId).toBe(saved.tabs[0]?.id ?? "missing");
  });
});
