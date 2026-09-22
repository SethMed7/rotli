import { expect, test } from "bun:test";

import { isImportedVaultSnapshot } from "./importedVault";

test("only a well-formed copy snapshot is read for migration", () => {
  expect(isImportedVaultSnapshot({ version: 1, name: "v", files: {}, dirs: [] })).toBe(true);
  expect(isImportedVaultSnapshot({ version: 2, name: "v", files: {}, dirs: [] })).toBe(false);
  expect(isImportedVaultSnapshot({ version: 1, name: "v", files: null, dirs: [] })).toBe(false);
  expect(isImportedVaultSnapshot("nope")).toBe(false);
});
