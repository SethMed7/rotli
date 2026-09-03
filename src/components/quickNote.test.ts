// The Quick Note window announces a newborn note and the MAIN window files it
// into Main — the quick webview holds EMPTY_MAIN and must never write the
// manifest. The filing itself is proven behaviourally in
// src/newItems/quickNoteFiling.test.ts and e2e/capture-vault-routing.spec.ts;
// this pins only the main-only gate, which lives in the shell's wiring.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.tsx", import.meta.url), "utf8");

test("only the main window files a quick-created note into Main", () => {
  const at = appSource.indexOf("onQuickCreated((");
  expect(at).toBeGreaterThan(0);
  expect(appSource.slice(at - 120, at)).toContain('if (surface !== "main") return;');
  expect(appSource.slice(at, at + 80)).toContain("fileQuickNoteInMain(id)");
});
