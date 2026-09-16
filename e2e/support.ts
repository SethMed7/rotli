// Shared E2E helpers. Every spec drives the browser twin (isTauri() === false
// under `vite dev`): the seeded in-memory demo corpus from src/services/notes.ts,
// deterministic across page loads (a fresh navigation re-runs the module-level
// seed). Selectors below reuse the data-* attributes and roles the surfaces
// already expose (see the components under src/components/) — no test-only
// markup was added for these flows.

import type { Locator, Page } from "@playwright/test";

/** Load the app and wait for the pane tree (the always-present tab strip) to
 * mount — the signal that the seeded corpus has rendered its first tab. */
export async function gotoApp(page: Page): Promise<void> {
  // ROTLI_E2E_APP_PATH=/app/ runs the same specs against the web build
  // served under its sub-path (bun run dev:web), so a shell fix is proved on
  // both twins with one spec.
  await page.goto(process.env.ROTLI_E2E_APP_PATH ?? "/");
  await page.getByRole("tablist").waitFor();
}

/** Drive the app's ONE pointer-drag gesture (src/lib/pointerDrag.ts) — real
 * mouse events, not HTML5 DnD, because HTML5 drag is dead in the macOS
 * WKWebView shell the app ships in, so the app never listens for it. Presses
 * on `from`, crosses the 5px Manhattan threshold that turns a press into a
 * drag, moves to the drop point, then releases. */
export async function pointerDrag(page: Page, from: Locator, to: { x: number; y: number }): Promise<void> {
  await from.scrollIntoViewIfNeeded();
  const box = await from.boundingBox();
  if (!box) throw new Error("drag source has no bounding box — is it visible?");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // clear the threshold first so the session's onStart fires before any
  // hit-testing move is read as a real drag
  await page.mouse.move(startX + 8, startY, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** The point Manhattan-nearest a locator's left edge (drop "before" it) or
 * right edge (drop "after"/"past" it) — mirrors the app's own midpoint hit-
 * tests (stripIndex in src/lib/tabDrag.ts, the after-half check in
 * BoardSurface's startCardDrag). */
export async function edgePoint(locator: Locator, side: "left" | "right"): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("target has no bounding box — is it visible?");
  const y = box.y + box.height / 2;
  return side === "left" ? { x: box.x + 2, y } : { x: box.x + box.width - 2, y };
}

/** A locator's own center point, in viewport coordinates. Scrolls it into
 * view first — the sidebar's Main section can sit below the fold. */
export async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("target has no bounding box — is it visible?");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
