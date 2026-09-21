// The sidebar's edge and reveal are the user's (the owner, 2026-09-17): Left or
// Right, always open or on hover — from Appearance → Sidebar and from the
// sidebar's own right-click menu. Both twins run this (ROTLI_E2E_APP_PATH).
import { expect, type Page, test } from "@playwright/test";

import { gotoApp } from "./support";

async function openAppearance(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sidebar" })).toBeVisible();
}

/** Into the edge strip: two moves, so a pointerenter lands even if the first
 * move raced the rail's mount under a loaded runner. */
async function enterEdge(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.move(x, y + 1);
}

/** Settings is its own full surface; the notes surface holds the rail. */
async function backToNotes(page: Page) {
  await page.getByText("Back to notes").click();
  await expect(page.locator(".threepane")).toBeVisible();
}

test("the sidebar moves to the right from Appearance, and back from its own menu", async ({ page }) => {
  await gotoApp(page);
  await openAppearance(page);
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await backToNotes(page);
  const pane = page.locator(".threepane");
  await expect(pane).toHaveAttribute("data-sidebar-side", "right");
  const sidebar = await page.locator("aside.sidebar").boundingBox();
  const paneBox = await pane.boundingBox();
  if (!sidebar || !paneBox) throw new Error("no layout");
  // the rail sits on the far right, the content to its left
  expect(sidebar.x + sidebar.width).toBeGreaterThan(paneBox.x + paneBox.width - 2);
  expect(sidebar.x).toBeGreaterThan(paneBox.x + paneBox.width / 2);

  // right-click the sidebar's own surface (not a row): move it back
  await page.locator("aside.sidebar").dispatchEvent("contextmenu", { clientX: 40, clientY: 300 });
  await page.getByRole("menuitem", { name: "Move sidebar to left" }).click();
  await expect(pane).toHaveAttribute("data-sidebar-side", "left");
  const back = await page.locator("aside.sidebar").boundingBox();
  expect(back?.x).toBeLessThan(20);
});

test("on hover the sidebar leaves the flow; the edge reveals it and leaving hides it", async ({ page }) => {
  await gotoApp(page);
  await openAppearance(page);
  await page.getByRole("button", { name: "On hover", exact: true }).click();
  await backToNotes(page);
  // closed: no rail, a hot strip on the left edge
  await expect(page.locator(".rail-wrap")).toHaveCount(0);
  const edge = page.locator(".warm-edge[data-side='left']");
  await expect(edge).toHaveCount(1);
  const box = await edge.boundingBox();
  if (!box) throw new Error("no edge");
  await enterEdge(page, box.x + 3, box.y + box.height / 2);
  const overlay = page.locator(".rail-hover aside.sidebar");
  await expect(overlay).toBeVisible();
  // away from it: gone
  await page.mouse.move(box.x + 700, box.y + box.height / 2);
  await expect(overlay).toHaveCount(0);
  // Always (from the sidebar's own menu, reached through the edge) puts it back in the flow
  await enterEdge(page, box.x + 3, box.y + box.height / 2);
  await expect(overlay).toBeVisible();
  await overlay.dispatchEvent("contextmenu", { clientX: 40, clientY: 300 });
  await expect(page.getByRole("menuitem", { name: "Open sidebar on hover" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Keep sidebar open" }).click();
  await expect(page.locator(".rail-wrap aside.sidebar")).toBeVisible();
});

test("on the right, the hover overlay comes off the right edge; Esc and ⌘0 close and open it", async ({
  page,
}) => {
  await gotoApp(page);
  await openAppearance(page);
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await page.getByRole("button", { name: "On hover", exact: true }).click();
  await backToNotes(page);
  const pane = page.locator(".threepane");
  const paneBox = (await pane.boundingBox())!;
  const edge = page.locator(".warm-edge[data-side='right']");
  const box = (await edge.boundingBox())!;
  expect(box.x + box.width).toBeGreaterThan(paneBox.x + paneBox.width - 2);
  await enterEdge(page, box.x + box.width - 3, box.y + box.height / 2);
  const overlay = page.locator(".rail-hover[data-side='right']");
  await expect(overlay).toBeVisible();
  const ov = (await overlay.boundingBox())!;
  expect(ov.x + ov.width).toBeGreaterThan(paneBox.x + paneBox.width - 2);
  expect(ov.x).toBeGreaterThan(paneBox.x + paneBox.width / 2);
  // Esc closes it under a resting pointer
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  // ⌘0 brings it back and takes it away without the pointer
  await page.mouse.move(paneBox.x + 200, paneBox.y + 200);
  await page.keyboard.press("Meta+0");
  await expect(overlay).toBeVisible();
  // and it STAYS: leaving the strip armed a close timer, and opening by key
  // must cancel it (CI caught the sidebar shutting itself 260ms after ⌘0)
  await page.waitForTimeout(450);
  await expect(overlay).toBeVisible();
  await page.keyboard.press("Meta+0");
  await expect(overlay).toHaveCount(0);
});

test("a graze never strands the overlay, and its own menu never dismisses it", async ({ page }) => {
  await gotoApp(page);
  await openAppearance(page);
  await page.getByRole("button", { name: "On hover", exact: true }).click();
  await backToNotes(page);
  const edge = page.locator(".warm-edge[data-side='left']");
  const box = (await edge.boundingBox())!;
  const overlay = page.locator(".rail-hover aside.sidebar");
  // in and straight back out, before the overlay can take the pointer
  await page.mouse.move(box.x + 3, box.y + 300);
  await page.mouse.move(box.x + 700, box.y + 300);
  await expect(overlay).toHaveCount(0, { timeout: 3000 });
  // open it, open its menu: the overlay stays under the menu
  await enterEdge(page, box.x + 3, box.y + 300);
  await expect(overlay).toBeVisible();
  await overlay.dispatchEvent("contextmenu", { clientX: 40, clientY: 300 });
  const menu = page.getByRole("menuitem", { name: "Move sidebar to right" });
  await expect(menu).toBeVisible();
  await page.mouse.move(box.x + 60, box.y + 320); // onto the menu, off the strip
  await page.waitForTimeout(400);
  await expect(overlay).toBeVisible();
  // dismiss the menu with the pointer away: now it goes
  await page.keyboard.press("Escape");
  await page.mouse.move(box.x + 700, box.y + 300);
  await expect(overlay).toHaveCount(0);
});

// The owner, 2026-09-18: hover should do what ⌘0 does — push the content, keep
// the resize grip — not float a separate overlay over the note.
test("revealed on hover, the sidebar pushes the content and keeps its resize grip", async ({ page }) => {
  await gotoApp(page);
  await openAppearance(page);
  await page.getByRole("button", { name: "On hover", exact: true }).click();
  await backToNotes(page);
  const panes = page.locator(".threepane > .panes");
  const closed = (await panes.boundingBox())!;
  expect(closed.x).toBeLessThan(2);
  await enterEdge(page, 3, 400);
  const sidebar = page.locator(".threepane aside.sidebar");
  await expect(sidebar).toBeVisible();
  const side = (await sidebar.boundingBox())!;
  const pushed = (await panes.boundingBox())!;
  // the content starts where the sidebar ends: nothing is covered
  expect(pushed.x).toBeGreaterThanOrEqual(side.x + side.width - 1);
  await expect(page.locator(".cm-content").first()).toBeVisible();
  // the grip is there, and a drag past the sidebar's own edge resizes it
  // without the leave timer closing the sidebar mid-drag
  const grip = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(grip).toBeVisible();
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(g.x + 60, 400, { steps: 4 });
  await page.waitForTimeout(400);
  await page.mouse.move(g.x + 70, 400);
  // the drag ends at +70 from the grip's left edge: wait for THAT width before
  // letting go, or a loaded runner reads the width one move early
  const dragged = 70 - g.width / 2;
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeGreaterThan(side.width + dragged - 1);
  await page.mouse.up();
  await expect(sidebar).toBeVisible();
  // the last move lands a frame after the button is up
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(side.width + 60);
  const wider = (await sidebar.boundingBox())!;
  // away: closed, and the content takes the whole width again
  await page.mouse.move(1000, 400);
  await expect(sidebar).toHaveCount(0);
  expect((await panes.boundingBox())!.x).toBeLessThan(2);
  // the width is remembered for the next reveal
  await enterEdge(page, 3, 400);
  await expect(sidebar).toBeVisible();
  expect(Math.abs((await sidebar.boundingBox())!.width - wider.width)).toBeLessThan(2);
});

// The owner's screenshot, 2026-09-18: the whole frame shifted ~230px left with
// find open. The frame clips its overflow but could still be scrolled by a
// scroll-into-view; it must never move sideways.
test("the app frame never scrolls sideways", async ({ page }) => {
  await gotoApp(page);
  const moved = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>(".threepane");
    if (!frame) return -1;
    frame.scrollLeft = 200;
    return frame.scrollLeft;
  });
  expect(moved).toBe(0);
});

// The owner, 2026-09-18: with the sidebar on the right, a right-click menu
// "comes out weird" — it was shoved along the window's edge, over the row that
// was clicked. It opens on the pointer's other side instead.
test("on the right edge a context menu opens leftward, ending at the pointer", async ({ page }) => {
  await gotoApp(page);
  await openAppearance(page);
  await page.getByRole("button", { name: "Right", exact: true }).click();
  await backToNotes(page);
  const menu = page.locator(".ctxmenu");
  // a REAL right-click: a dispatched contextmenu event carries no coordinates,
  // so the menu would be placed from nothing
  const box = (await page.locator("aside.sidebar").boundingBox())!;
  const x = Math.round(box.x + box.width - 30);
  let y = 0;
  for (const tryY of [480, 520, 560, 600]) {
    await page.mouse.click(x, tryY, { button: "right" });
    if ((await menu.count()) > 0) {
      y = tryY;
      break;
    }
  }
  expect(y, "no empty sidebar surface found to right-click").toBeGreaterThan(0);
  await expect(menu).toBeVisible();
  const placed = (await menu.boundingBox())!;
  // it ends AT the pointer and starts at its height: the clicked spot is not
  // underneath it, and it is not shoved along the window's edge
  expect(Math.abs(placed.x + placed.width - x)).toBeLessThan(1.5);
  expect(Math.abs(placed.y - y)).toBeLessThan(1.5);
  // moved to the left, with room, it opens right from the pointer as before
  await page.getByRole("menuitem", { name: "Move sidebar to left" }).click();
  await page.mouse.click(60, y, { button: "right" });
  await expect(menu).toBeVisible();
  expect(Math.abs((await menu.boundingBox())!.x - 60)).toBeLessThan(1.5);
});

// The owner, 2026-09-21: right-click the pinned sidebar and pick "Open sidebar
// on hover" — the sidebar must actually change mode: leave the flow and close.
test("the sidebar's own menu always offers the other reveal, and picking it switches", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".rail-wrap aside.sidebar")).toBeVisible();
  const menu = page.locator(".ctxmenu");
  const box = (await page.locator("aside.sidebar").boundingBox())!;
  let opened = false;
  for (const y of [480, 520, 560, 600]) {
    await page.mouse.click(box.x + 40, y, { button: "right" });
    if ((await menu.count()) > 0) {
      opened = true;
      break;
    }
  }
  expect(opened, "no empty sidebar surface found to right-click").toBe(true);
  await page.getByRole("menuitem", { name: "Open sidebar on hover" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".warm-edge[data-side='left']")).toHaveCount(1);
  await expect(page.locator("aside.sidebar")).toHaveCount(0);
  // reached through the edge, the menu now offers the way back
  await enterEdge(page, 3, 400);
  const overlay = page.locator(".rail-hover aside.sidebar");
  await expect(overlay).toBeVisible();
  await overlay.dispatchEvent("contextmenu", { clientX: 40, clientY: 300 });
  await expect(page.getByRole("menuitem", { name: "Open sidebar on hover" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Keep sidebar open" })).toBeVisible();
});
