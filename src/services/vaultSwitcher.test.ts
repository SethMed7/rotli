// Vault-switcher projection locks: current first, connected targets after it.

import { describe, expect, test } from "bun:test";

import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import { vaultDisplayName, vaultRowLabel, vaultSwitcherItems } from "./vaultSwitcher";

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
