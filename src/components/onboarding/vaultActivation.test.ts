import { describe, expect, test } from "bun:test";

import { folderMismatch, keepableVault, vaultChoiceLabel } from "./vaultActivation";

describe("vault activation primary action", () => {
  test("names the exact next action instead of a generic folder choice", () => {
    expect(vaultChoiceLabel("create")).toBe("Choose an empty folder");
    expect(vaultChoiceLabel("open")).toBe("Choose an existing folder");
    expect(vaultChoiceLabel("current")).toBe("Use this vault");
  });
});

test("setup offers to keep a vault this install chose, never the one a debug build borrows", () => {
  const corpus = { absPath: "/Users/me/memex-vault", isMemex: true, memexId: "mx_1" } as Parameters<
    typeof keepableVault
  >[0]["corpus"];
  expect(keepableVault({ corpus, developmentReadOnly: false })).toBe(corpus);
  // borrowed read-only to boot: keeping it would record nothing, and setup would ask again
  expect(keepableVault({ corpus, developmentReadOnly: true })).toBeNull();
});

test("picking the folder is the confirmation, so a folder that doesn't fit says why first", () => {
  expect(folderMismatch("create", "empty")).toBeNull();
  expect(folderMismatch("create", "markdown")).toMatch(/already has files/);
  expect(folderMismatch("create", "memex")).toMatch(/already has files/);
  expect(folderMismatch("open", "markdown")).toBeNull();
  expect(folderMismatch("open", "memex")).toBeNull();
  expect(folderMismatch("open", "empty")).toMatch(/is empty/);
});
