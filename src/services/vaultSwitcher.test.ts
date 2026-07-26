// Vault-switcher menu grammar locks: the current vault is a highlighted no-op,
// other vaults switch by ROOT (the relaunching repoint), the connect/settings
// pair always exists, and the relaunch honesty line appears exactly when a
// switch is actually possible.

import { describe, expect, test } from "bun:test";
import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import { buildVaultMenu, vaultDisplayName } from "./vaultSwitcher";

const inst = (over: Partial<MemexInstance>): MemexInstance => ({
  id: "mx1",
  label: "memex-vault",
  root: "/Users/seth/memex-vault",
  role: "brain",
  memexId: "mx_abc",
  mode: "local",
  perms: "read-only",
  brainEnabled: true,
  ...over,
});

const handlers = () => {
  const calls: { switched: string[]; connected: number; created: number; settings: number } = {
    switched: [],
    connected: 0,
    created: 0,
    settings: 0,
  };
  return {
    calls,
    h: {
      switchTo: (root: string) => calls.switched.push(root),
      connect: () => (calls.connected += 1),
      createNew: () => (calls.created += 1),
      openSettings: () => (calls.settings += 1),
    },
  };
};

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

describe("buildVaultMenu", () => {
  test("current vault is a highlighted no-op; others switch by root", () => {
    const { calls, h } = handlers();
    const items = buildVaultMenu(
      [inst({ id: CORPUS_INSTANCE_ID, label: "my-vault", root: "/v/main" }), inst({})],
      h,
    );
    const actions = items.filter((i) => i.kind === "action");
    expect(actions[0]).toMatchObject({ label: "my-vault", checked: true, checkedMark: "highlight" });
    actions[0]!.kind === "action" && actions[0]!.onClick();
    expect(calls.switched).toEqual([]);
    expect(actions[1]).toMatchObject({ label: "memex-vault", checked: false });
    actions[1]!.kind === "action" && actions[1]!.onClick();
    expect(calls.switched).toEqual(["/Users/seth/memex-vault"]);
  });

  test("connect and settings always exist; honesty line only when a switch exists", () => {
    const { calls, h } = handlers();
    const solo = buildVaultMenu([inst({ id: CORPUS_INSTANCE_ID })], h);
    const soloLabels = solo
      .filter((i) => i.kind === "action")
      .map((i) => (i.kind === "action" ? i.label : ""));
    expect(soloLabels).toContain("Connect another vault…");
    expect(soloLabels).toContain("Location settings…");
    expect(soloLabels.join()).not.toContain("relaunches");

    const multi = buildVaultMenu([inst({ id: CORPUS_INSTANCE_ID }), inst({})], h);
    const hint = multi.find((i) => i.kind === "action" && i.label.includes("relaunches"));
    expect(hint && hint.kind === "action" ? hint.disabled : false).toBe(true);

    const connect = multi.find((i) => i.kind === "action" && i.label.startsWith("Connect"));
    connect!.kind === "action" && connect!.onClick();
    expect(calls.connected).toBe(1);
  });

  test("an empty instance list still offers new + connect + settings (fresh install)", () => {
    const { h } = handlers();
    const items = buildVaultMenu([], h);
    expect(items.filter((i) => i.kind === "action").length).toBe(3);
    expect(items.some((i) => i.kind === "sep")).toBe(false);
  });

  test("raw vaults carry a quiet suffix; Librarian-on stays unmarked (calm)", () => {
    const { calls, h } = handlers();
    const items = buildVaultMenu(
      [
        inst({ id: CORPUS_INSTANCE_ID, label: "my-vault", brainEnabled: false }),
        inst({ label: "work-vault", brainEnabled: true }),
      ],
      h,
    );
    const labels = items.filter((i) => i.kind === "action").map((i) => (i.kind === "action" ? i.label : ""));
    expect(labels[0]).toBe("my-vault · raw");
    expect(labels[1]).toBe("work-vault");

    const create = items.find((i) => i.kind === "action" && i.label === "New vault…");
    create!.kind === "action" && create!.onClick();
    expect(calls.created).toBe(1);
  });
});
