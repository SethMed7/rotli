import { expect, test } from "bun:test";

import { connectDialogCopy } from "./webVaultConnectDialog";

test("the live-folder copy promises nothing leaves the computer and explains the browser's prompt", () => {
  const copy = connectDialogCopy({ kind: "live" });
  expect(copy.title).toBe("Connect a vault");
  expect(copy.lines.join(" ")).toMatch(/Nothing leaves your computer/);
  expect(copy.lines.join(" ")).toMatch(/view and save changes/);
});

test("the import copy names the browser, warns about the word upload, and offers export", () => {
  const name = ["Ze", "n"].join("");
  const copy = connectDialogCopy({ kind: "import-only", browser: name });
  expect(copy.title).toBe("Connect a vault");
  expect(copy.lines[0]?.startsWith(`${name} can read a vault`)).toBe(true);
  expect(copy.lines.join(" ")).toMatch(/“upload”/);
  expect(copy.lines.join(" ")).toMatch(/Export vault/);
  expect(connectDialogCopy({ kind: "brave-off" }).lines[0]).toMatch(/flags/);
});
