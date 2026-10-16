// Vault-switcher projection locks: current first, connected targets after it.

import { describe, expect, test } from "bun:test";

import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import {
  connectPlan,
  addedVault,
  outgoingVaultId,
  vaultDisplayName,
  vaultRemovePlan,
  vaultSwitcherItems,
} from "./vaultSwitcher";

const inst = (over: Partial<MemexInstance>): MemexInstance => ({
  id: "mx1",
  label: "memex-vault",
  root: "/Users/example/memex-vault",
  role: "brain",
  memexId: "mx_abc",
  mode: "local",
  perms: "read-only",
  brainEnabled: true,
  layout: "memex",
  inPlace: false,
  ...over,
});

describe("vaultDisplayName", () => {
  test("uses the corpus instance label", () => {
    expect(vaultDisplayName([inst({ id: CORPUS_INSTANCE_ID, label: "my-vault" }), inst({})])).toBe(
      "my-vault",
    );
  });

  test("falls back when no corpus instance exists (browser demo)", () => {
    expect(vaultDisplayName([])).toBe("rotli");
  });
});

describe("vaultSwitcherItems", () => {
  test("projects the current vault first and marks only it active", () => {
    const items = vaultSwitcherItems([
      inst({ id: "mx1", label: "connected" }),
      inst({ id: CORPUS_INSTANCE_ID, label: "my-vault", root: "/v/main" }),
    ]);
    expect(items.map(({ instance }) => instance.label)).toEqual(["my-vault", "connected"]);
    expect(items.map(({ active }) => active)).toEqual([true, false]);
  });

  test("an empty instance list projects no fake rows", () => {
    expect(vaultSwitcherItems([])).toEqual([]);
  });
});

describe("vaultRemovePlan", () => {
  const current = { instance: inst({ id: CORPUS_INSTANCE_ID, label: "current" }), active: true };
  const other = { instance: inst({ id: "mx2", label: "Old notes" }), active: false };

  test("a connected vault is removed as it is", () => {
    expect(vaultRemovePlan([current, other], other)).toEqual({ kind: "forget" });
  });

  test("the current vault is removed by switching to the next one first", () => {
    expect(vaultRemovePlan([current, other], current)).toEqual({ kind: "switch", to: other.instance });
  });

  test("a lone vault is replaced by one the person picks first, never left vault-less", () => {
    expect(vaultRemovePlan([current], current)).toEqual({ kind: "replace" });
  });
});

describe("addedVault", () => {
  test("is the vault in the list after a Connect that was not there before", () => {
    const before = [inst({ id: CORPUS_INSTANCE_ID }), inst({ id: "mx1" })];
    const after = [...before, inst({ id: "mx7", label: "New" })];
    expect(addedVault(before, after)?.id).toBe("mx7");
    expect(addedVault(before, before)).toBeNull();
  });
});

describe("outgoingVaultId", () => {
  test("finds the vault the shell just left by its folder, never the live route", () => {
    const instances = [
      inst({ id: CORPUS_INSTANCE_ID, root: "/v/next" }),
      inst({ id: "mx9", root: "/v/old" }),
    ];
    expect(outgoingVaultId(instances, "/v/old")).toBe("mx9");
    expect(outgoingVaultId(instances, "/v/next")).toBeNull();
  });
});

describe("an open folder that is not a vault", () => {
  const folder = inst({ id: CORPUS_INSTANCE_ID, label: "Obsidian Notes", memexId: null, role: "corpus" });

  test("is still the current row and names the header", () => {
    const items = vaultSwitcherItems([inst({ id: "mx1", label: "connected" })], folder);
    expect(items.map(({ instance, active }) => [instance.label, active])).toEqual([
      ["Obsidian Notes", true],
      ["connected", false],
    ]);
    expect(vaultDisplayName([], folder)).toBe("Obsidian Notes");
  });

  test("a vault corpus wins over the plain-folder row", () => {
    const vault = inst({ id: CORPUS_INSTANCE_ID, label: "memex-vault" });
    expect(vaultSwitcherItems([vault], folder).map(({ instance }) => instance.label)).toEqual([
      "memex-vault",
    ]);
  });
});

describe("connectPlan", () => {
  test("Connect vault refuses nothing: empty creates, a vault links, any other folder opens in place", () => {
    expect(connectPlan("empty")).toBe("create");
    expect(connectPlan("memex")).toBe("link");
    expect(connectPlan("markdown")).toBe("open");
  });
});
