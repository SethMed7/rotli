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
  // out of the flow: no rail, a hot strip on the left edge
  await expect(page.locator(".rail-wrap")).toHaveCount(0);
  const edge = page.locator(".warm-edge[data-side='left']");
  await expect(edge).toHaveCount(1);
  const box = await edge.boundingBox();
  if (!box) throw new Error("no edge");
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  const overlay = page.locator(".rail-overlay aside.sidebar");
  await expect(overlay).toBeVisible();
  // away from it: gone
  await page.mouse.move(box.x + 700, box.y + box.height / 2);
  await expect(overlay).toHaveCount(0);
  // Always (from the sidebar's own menu, reached through the edge) puts it back in the flow
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await expect(overlay).toBeVisible();
  await overlay.dispatchEvent("contextmenu", { clientX: 40, clientY: 300 });
  await page.getByRole("menuitemcheckbox", { name: "Keep sidebar open" }).click();
  await expect(page.locator(".rail-wrap aside.sidebar")).toBeVisible();
});
