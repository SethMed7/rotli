// Vault-switcher projection locks: current first, connected targets after it.

import { describe, expect, test } from "bun:test";

import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import {
  connectPlan,
  vaultDisplayName,
  vaultOverflowItems,
  vaultRowLabel,
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

  test("raw vaults carry a quiet suffix; Librarian-on stays unmarked (calm)", () => {
    expect(vaultRowLabel(inst({ label: "my-vault", brainEnabled: false }))).toBe("my-vault · raw");
    expect(vaultRowLabel(inst({ label: "work-vault", brainEnabled: true }))).toBe("work-vault");
  });

  test("an empty instance list projects no fake rows", () => {
    expect(vaultSwitcherItems([])).toEqual([]);
  });
});

describe("vaultOverflowItems", () => {
  const on = { openLocationSettings: () => {}, remove: () => {} };
  test("a connected vault removes behind a drill that names it and says the folder stays", () => {
    const items = vaultOverflowItems(inst({ label: "Old notes" }), false, on);
    expect(items[0]).toMatchObject({ kind: "action", label: expect.stringMatching(/^Location settings/) });
    const drill = items.at(-1);
    expect(drill).toMatchObject({
      kind: "drill",
      label: expect.stringMatching(/^Remove from Rotli/),
      danger: true,
    });
    if (drill?.kind !== "drill") throw new Error("expected a drill");
    expect(drill.items[0]).toMatchObject({ kind: "action", label: "Remove Old notes", danger: true });
    expect(drill.items[1]).toMatchObject({
      disabled: true,
      label: expect.stringContaining("stay where they are"),
    });
  });

  test("the active vault cannot be removed until another is active", () => {
    const items = vaultOverflowItems(inst({ label: "current" }), true, on);
    expect(items.at(-1)).toMatchObject({
      kind: "action",
      disabled: true,
      label: expect.stringContaining("switch vaults first"),
    });
    expect(items.some((item) => item.kind === "drill")).toBe(false);
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
