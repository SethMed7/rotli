import { describe, expect, test } from "bun:test";

import type { WorkspaceOpenRequest } from "../lib/tauri";
import { type OpenRequestDeps, routeOpenRequest } from "./openRequest";
import { canOpenVaultInPanes, contentVaultId } from "./paneVaults";

function harness(switchResult: boolean | Error) {
  const calls: string[] = [];
  const opened: WorkspaceOpenRequest[] = [];
  const failures: string[] = [];
  const deps: OpenRequestDeps = {
    switchVault: async (id) => {
      calls.push(`switch:${id}`);
      if (switchResult instanceof Error) throw switchResult;
      return switchResult;
    },
    refreshActiveVault: async () => {
      calls.push("refresh");
    },
    open: (item) => {
      calls.push("open");
      opened.push(item);
    },
    fail: (message) => failures.push(message),
  };
  return { deps, calls, opened, failures };
}

describe("routing a queued open request", () => {
  test("an item in the active vault opens as queued, no switch", async () => {
    const h = harness(true);
    await routeOpenRequest({ id: "01JNOTE", kind: "note" }, h.deps);
    expect(h.calls).toEqual(["open"]);
    expect(h.opened).toEqual([{ id: "01JNOTE", kind: "note" }]);
  });

  // Review hold (agents lane PR): a connected vault's prefixed id used to reach the
  // pane guard as-is and stop at "belongs to another vault".
  test("an item in a connected vault switches, rebinds, then opens by its id there", async () => {
    const h = harness(true);
    await routeOpenRequest({ id: "work:wiki/plan.md", kind: "note" }, h.deps);
    expect(h.calls).toEqual(["switch:work", "refresh", "open"]);
    const [item] = h.opened;
    expect(item).toEqual({ id: "wiki/plan.md", kind: "note" });
    // what reaches the panes now passes their vault guard
    expect(canOpenVaultInPanes(contentVaultId(item!.id))).toBe(true);
    expect(h.failures).toEqual([]);
  });

  test("a switch that throws or changes nothing opens nothing and says why", async () => {
    for (const result of [new Error("no such connected vault"), false]) {
      const h = harness(result);
      await routeOpenRequest({ id: "notes-folder:a.md", kind: "note" }, h.deps);
      expect(h.opened).toEqual([]);
      expect(h.calls).not.toContain("refresh");
      expect(h.failures).toHaveLength(1);
      expect(h.failures[0]).toContain("Couldn't switch to the vault");
    }
  });
});
