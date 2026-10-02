import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  folderMismatch,
  keepableVault,
  openedOrWhy,
  VaultActivation,
  vaultChoiceLabel,
} from "./vaultActivation";

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

test("setup moves on from Open only when the folder really is the vault now", () => {
  expect(openedOrWhy(true, true)).toBeNull();
  // the vault already in use, chosen again: nothing to do, and that's fine
  expect(openedOrWhy(false, true)).toBeNull();
  // a debug build's borrowed vault: "opening" it recorded nothing
  expect(openedOrWhy(false, false)).toMatch(/read-only/);
});

test("a new vault outside setup asks about the Librarian; in setup its own screen does", () => {
  const outside = renderToStaticMarkup(<VaultActivation />);
  expect(outside).toContain('aria-label="Librarian choice"');
  expect(outside).toContain("Raw vault");
  const inSetup = renderToStaticMarkup(<VaultActivation onboarding />);
  expect(inSetup).not.toContain('aria-label="Librarian choice"');
  // one decision: the folder pick is the confirmation, no second screen
  expect(inSetup).toContain(">Choose an empty folder<");
});
