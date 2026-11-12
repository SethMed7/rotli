// A modal dialog keeps keyboard focus inside it (system audit 2026-09-02 §4
// #2): Tab past its last control comes back to its first, instead of walking
// into the page behind it. Every component that declares aria-modal must use
// the one shared trap, src/lib/dialogFocus.ts containDialogFocus.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

/** Dialogs that trap Tab with their own handler, and where. */
const OWN_TRAP = new Set([
  "editor/mermaidWorkspace.tsx", // onPanelKeyDown cycles focusableInside(panel)
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".tsx") && !path.includes(".test.") ? [path] : [];
  });
}

test("every modal dialog traps Tab with containDialogFocus", () => {
  const leaky = sources(SRC)
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return /aria-modal=(?:"true"|\{true\})/.test(source) && !source.includes("containDialogFocus");
    })
    .map((file) => file.slice(SRC.length))
    .filter((file) => !OWN_TRAP.has(file));
  expect(leaky).toEqual([]);
});
