import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { keepableVault, openedOrWhy, VaultActivation, vaultPlan } from "./vaultActivation";

test("setup offers to keep a vault this install chose, never the one a debug build borrows", () => {
  const corpus = { absPath: "/Users/me/memex-vault", isMemex: true, memexId: "mx_1" } as Parameters<
    typeof keepableVault
  >[0]["corpus"];
  expect(keepableVault({ corpus, developmentReadOnly: false })).toBe(corpus);
  // borrowed read-only to boot: keeping it would record nothing, and setup would ask again
  expect(keepableVault({ corpus, developmentReadOnly: true })).toBeNull();
});

test("the folder decides: an empty one becomes a fresh vault, one with notes is used as it is", () => {
  expect(vaultPlan("empty")).toBe("create");
  expect(vaultPlan("markdown")).toBe("open");
  expect(vaultPlan("memex")).toBe("open");
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
  // one action: the macOS folder panel, no create-or-open cards before it
  expect(inSetup).toContain(">Choose a folder<");
  expect(inSetup).not.toContain('aria-label="Vault choice"');
});

test("after Skip setup the vault screen says it is the one thing left", () => {
  expect(renderToStaticMarkup(<VaultActivation onboarding skipping />)).toContain(
    "One thing before you start",
  );
  expect(renderToStaticMarkup(<VaultActivation onboarding />)).not.toContain("One thing before you start");
});
