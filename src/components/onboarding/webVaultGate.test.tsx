import { expect, test } from "bun:test";

import type { VaultConnection } from "../../state/vaultConnection";
import { setupStage } from "./webVaultGate";

const live = { kind: "live" } as const;
const zen = { kind: "import-only", browser: "Zen" } as const;
const unbound: VaultConnection = { status: "unbound" };

test("Chrome's first visit chooses a folder; a remembered one asks to reconnect it by name", () => {
  expect(setupStage(unbound, live, false, null)).toEqual({ kind: "folder", pending: null });
  expect(setupStage({ status: "needs-permission", name: "memex" }, live, false, null)).toEqual({
    kind: "folder",
    pending: "memex",
  });
});

test("a browser without a folder API starts with the helper, then the vault it serves", () => {
  expect(setupStage(unbound, zen, false, null)).toEqual({ kind: "helper", problem: "missing", vault: null });
  expect(setupStage(unbound, zen, true, { kind: "offline" })).toEqual({
    kind: "helper",
    problem: "offline",
    vault: null,
  });
  const info = { name: "notes", id: "hv_1", empty: true };
  expect(setupStage(unbound, zen, true, { kind: "serving", info })).toEqual({
    kind: "vault",
    served: info,
    expected: null,
  });
  expect(setupStage({ status: "helper-no-vault" }, zen, true, null)).toEqual({
    kind: "vault",
    served: null,
    expected: null,
  });
});

test("a bound helper vault that can't open names the vault and the fix, never another store", () => {
  expect(setupStage({ status: "helper-offline", name: "memex" }, zen, true, null)).toEqual({
    kind: "helper",
    problem: "offline",
    vault: "memex",
  });
  expect(setupStage({ status: "helper-refused", name: "memex" }, zen, true, null).kind).toBe("helper");
  expect(setupStage({ status: "helper-refused", name: "memex" }, zen, false, null)).toEqual({
    kind: "helper",
    problem: "missing",
    vault: "memex",
  });
  expect(setupStage({ status: "helper-outdated", name: null }, zen, true, null)).toMatchObject({
    problem: "outdated",
  });
  const served = { name: "other", id: "hv_2", empty: false };
  expect(
    setupStage({ status: "vault-mismatch", expected: "memex", served: "other" }, zen, true, {
      kind: "serving",
      info: served,
    }),
  ).toEqual({ kind: "vault", served, expected: "memex" });
});

test("Safari and phones are told plainly, with the way forward", () => {
  expect(setupStage({ status: "unsupported", browser: "Safari" }, zen, false, null)).toEqual({
    kind: "unsupported",
    browser: "Safari",
  });
});
