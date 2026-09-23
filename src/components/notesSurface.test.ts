import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const notesSurfaceSource = readFileSync(new URL("notesSurface.tsx", import.meta.url), "utf8");
const titlebarSource = readFileSync(new URL("titlebar.tsx", import.meta.url), "utf8");

test("an empty vault keeps the workspace shell instead of replacing it", () => {
  expect(notesSurfaceSource).not.toContain("return <EmptyState />");
  expect(notesSurfaceSource).toContain('<div className="threepane"');
  expect(notesSurfaceSource).toContain("vaultIsEmpty");
  expect(notesSurfaceSource).toContain("<PaneTree />");
});

test("the workspace no longer substitutes a virtual welcome surface", () => {
  expect(notesSurfaceSource).not.toContain("emptyPresentation");
  expect(notesSurfaceSource).not.toContain("VaultWelcomeSurface");
});

test("titlebar creation and pane controls teach the exact actions they run", () => {
  // the chord is named only where the build answers it (lib/hotkeyHint.ts)
  expect(titlebarSource).toContain('label={`New…${hotkeyHint(" — ⌘N")}`}');
  expect(titlebarSource).toContain('hotkey="tabs.newChooser"');
  expect(titlebarSource).toContain('hotkey="panes.splitRight"');
  expect(titlebarSource).toContain('hotkey="panes.splitDown"');
});
