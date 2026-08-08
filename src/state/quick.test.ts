import { expect, test } from "bun:test";

import { applyQuickState } from "./quick";
import { useUiStore } from "./ui";

test("the floating Quick Note webview receives its exact vault choice", () => {
  const before = useUiStore.getState();
  try {
    applyQuickState({ ids: ["quick:01NOTE"], activeId: "quick:01NOTE", folder: "Inbox", vaultId: "quick" });
    const state = useUiStore.getState();
    expect(state.quickNoteIds).toEqual(["quick:01NOTE"]);
    expect(state.quickActiveId).toBe("quick:01NOTE");
    expect(state.quickVaultId).toBe("quick");
  } finally {
    useUiStore.setState(before, true);
  }
});
