// Regression-layer handoff item 2 (docs/architecture/code-audit.md): sidebar
// cross-section drag. Sidebar.tsx's own comment names this exact gesture —
// "a note dragged FROM the Brain (or any note list) INTO Main" — implemented
// by the local `startMainDrag(..., "add")` pointer session (distinct from the
// shared src/lib/mainAddDrag.ts module covered by main-add-drag.spec.ts).
//
// The source note must be Main-eligible: src/services/mainTree.ts's
// buildMainTree deliberately never RENDERS a Main row for a Vault note (kept
// in the manifest, just hidden — "if it's not in the Brain or Storage, Main
// shouldn't have it"), so this drags a Storage note, not a Vault one.

import { expect, test } from "@playwright/test";
import { centerOf, gotoApp, pointerDrag } from "./support";

// Both the drag source and the Main drop target live in the ONE sidebar
// scroll container, and Storage's default type-grouping adds two more
// expansion levels (Storage → Other → the note) between them. A tall
// viewport keeps Main and the source on screen together — a real user would
// otherwise need two gestures (scroll, then drag), which this single
// pointer-drag session doesn't model (the app has no drag-to-edge autoscroll).
test.use({ viewport: { width: 1280, height: 2000 } });

test("dragging a note from Storage into Main adds a reference without moving it", async ({ page }) => {
  await gotoApp(page);

  // Main starts empty — the empty-state paragraph itself is the drop target
  // (data-main-id="main:", the whole-Main-zone marker in mainDropAt/startMainDrag)
  const mainRoot = page.locator('[data-main-id="main:"]');
  await expect(mainRoot).toContainText("arranged your way");

  // Storage groups by file type by default (src/services/storageTree.ts); every
  // seeded .md note lands in the synthetic "Other" bucket — expand Storage, then
  // Other, to reach a plain note row.
  await page.locator(".frow", { hasText: "Storage" }).first().click();
  await page.locator(".frow", { hasText: "Other" }).first().click();
  const source = page.locator("[data-note-id]", { hasText: "Groceries" });
  await expect(source).toBeVisible();

  await pointerDrag(page, source, await centerOf(mainRoot));

  // the note now appears under Main …
  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Groceries" })).toBeVisible();
  // … and Main is a reference, not a move: Storage still has its copy
  await expect(page.locator("[data-note-id]", { hasText: "Groceries" })).toHaveCount(2);
});
