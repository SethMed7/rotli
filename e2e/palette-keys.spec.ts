// Repro spec: ⌘K palette must support ↑/↓ selection and ⏎ open (r3 frame F's
// footer promise). Written against the browser twin's seeded demo corpus.

import { type Page, expect, test } from "@playwright/test";

import { gotoApp } from "./support";

/** The app registers ⌘K (Meta) only — a synthesized Ctrl+K does nothing on the
 * Linux runners (the 0.41.0 lesson). The titlebar search button dispatches the
 * same palette.toggle on every platform. */
async function openPalette(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
}

test("palette: arrows move the selection and Enter opens the row", async ({ page }) => {
  await gotoApp(page);
  await openPalette(page);
  const input = page.getByPlaceholder("Search notes, files, chats, actions…");
  await expect(input).toBeFocused();

  // empty query — Recent + Suggested rows exist
  const rows = page.locator(".prow");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);

  await expect(rows.nth(0)).toHaveClass(/sel/);
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toHaveClass(/sel/);
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(0)).toHaveClass(/sel/);

  // typed query, then Enter opens the selected note as the active tab
  await input.fill("Welcome");
  await page.keyboard.press("ArrowDown");
  const selLabel = await page.locator(".prow.sel .plabel").innerText();
  await page.keyboard.press("Enter");
  await expect(page.locator(".palette")).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText(selLabel.slice(0, 8));
});

test("palette: the titlebar field stays crisp above a focused fade and anchored results", async ({
  page,
}) => {
  await gotoApp(page);
  const closed = page.getByRole("button", { name: /Search notes and actions/ });
  const closedBox = await closed.boundingBox();
  if (!closedBox) throw new Error("closed search field has no box");

  await closed.click();
  const input = page.getByRole("combobox", {
    name: "Search notes and actions",
  });
  await expect(input).toBeFocused();
  await expect(page.locator(".pal-scrim")).toHaveCount(0);

  const fade = page.getByRole("button", { name: "Close search" });
  await expect(fade).toBeVisible();
  const fadePresentation = await fade.evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      box: { top: box.top, left: box.left, right: box.right, bottom: box.bottom },
      viewport: { width: innerWidth, height: innerHeight },
      background: style.backgroundColor,
      filter: style.filter,
      backdropFilter: style.getPropertyValue("backdrop-filter"),
    };
  });
  expect(fadePresentation.box).toEqual({
    top: 0,
    left: 0,
    right: fadePresentation.viewport.width,
    bottom: fadePresentation.viewport.height,
  });
  expect(fadePresentation.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(fadePresentation.filter).toBe("none");
  expect(fadePresentation.backdropFilter).toBe("none");

  const openField = page.locator(".tb-search.is-open");
  const results = page.locator(".palette");
  const [openBox, resultsBox] = await Promise.all([openField.boundingBox(), results.boundingBox()]);
  if (!openBox || !resultsBox) throw new Error("open search geometry is unavailable");

  expect(Math.abs(openBox.x - closedBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(openBox.width - closedBox.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(resultsBox.x - openBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(resultsBox.width - openBox.width)).toBeLessThanOrEqual(1);
  expect(resultsBox.y).toBeGreaterThanOrEqual(openBox.y + openBox.height);
});

test("palette: clicking the surrounding fade closes search", async ({ page }) => {
  await gotoApp(page);
  await openPalette(page);
  await page.getByRole("button", { name: "Close search" }).click({ position: { x: 10, y: 200 } });
  await expect(page.locator(".palette")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Search notes and actions/ })).toBeVisible();
});

test("palette: arrows keep working while the cursor rests over the list", async ({ page }) => {
  // the regression: ↑↓ scrolls the list, rows shift under the stationary
  // cursor, Chromium fires synthetic hover events, and a hover-driven
  // setIndex snaps the selection back — arrows read as dead
  await gotoApp(page);
  await openPalette(page);
  const input = page.getByPlaceholder("Search notes, files, chats, actions…");
  await input.fill("e"); // broad match — enough rows to overflow the 384px list
  const rows = page.locator(".prow");
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);
  // park the cursor over a row so hover votes are in play
  await rows.nth(1).hover();
  for (let i = 0; i < count - 1; i++) await page.keyboard.press("ArrowDown");
  await expect(rows.nth(count - 1)).toHaveClass(/sel/);
});

test("a title with every word in another order ranks first and lights each word", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  const input = page.getByRole("combobox", { name: /Search/ });
  await input.fill("checklist launch");
  const first = page.locator(".prow").first();
  await expect(first.locator(".plabel")).toContainText("Launch checklist");
  const lit = first.locator(".plabel mark.hitmark");
  await expect(lit).toHaveText(["Launch", "checklist"]);
  // evident but subtle: a tint plus medium weight, not a highlighter stripe
  await expect(lit.first()).toHaveCSS("font-weight", "600");
});
