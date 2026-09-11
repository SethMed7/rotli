import { expect, test } from "bun:test";

import { makeChatTab, makeNewItemTab, makeTab } from "./paneTabs";

test("pending creation tabs carry session intent without a durable note identity", () => {
  const pending = makeNewItemTab("Markdown note", true);
  expect(pending).toMatchObject({ surfaceKind: "newItem", pendingLabel: "Markdown note", pendingNote: true });
  expect("noteId" in pending).toBe(false);
  const first = makeTab("same-note");
  const second = makeTab("same-note");
  expect(first.id).not.toBe(second.id);
  expect(first).toMatchObject({ surfaceKind: "note", noteId: "same-note" });
  expect(makeChatTab(null, "linked-vault")).toMatchObject({
    surfaceKind: "chat",
    chatSlug: null,
    vaultId: "linked-vault",
  });
});
