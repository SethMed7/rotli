// ⇧-click ranges and Select all (the owner's 2026-09-16 items 7–9): one rule
// (lib/rangeSelect) across Captures, the Main tree, and the System browser.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("Captures: ⇧-click selects the range and Select all takes every card", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "Captures" }).first().click();
  const cards = page.locator(".board-card");
  await expect(cards).toHaveCount(3);

  await cards.nth(0).click();
  await cards.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.locator('.board-card[aria-pressed="true"]')).toHaveCount(3);
  await expect(page.locator(".board-bar-count")).toContainText("3 selected");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.locator('.board-card[aria-pressed="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.locator('.board-card[aria-pressed="true"]')).toHaveCount(3);
});

test("Main tree: ⇧-click gathers the rows between the last click and this one", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const mainRoot = page.locator('[data-main-id="main:"]');
  for (const title of ["Q3 priorities — Northstar", "Pricing decision", "Groceries"]) {
    await pointerDrag(page, page.locator(".recent-row", { hasText: title }), await centerOf(mainRoot));
    await expect(page.locator(".main-tree [data-main-id]", { hasText: title })).toBeVisible();
  }
  const rows = page.locator(".main-tree .main-row");
  await expect(rows).toHaveCount(3);
  await rows.nth(0).click({ modifiers: ["Meta"] });
  await rows.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.locator(".main-tree .main-row.msel")).toHaveCount(3);
});

test("System browser: ⇧-click ranges folder tiles", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".frow", { hasText: "Library" }).first().click();
  await expect(page.locator(".system-browser .board-title")).toHaveText("Library");
  const projects = page.locator(".system-browser .fdr-tile", { hasText: "Projects" });
  const people = page.locator(".system-browser .fdr-tile", { hasText: "People" });
  await projects.click();
  await people.click({ modifiers: ["Shift"] });
  await expect(projects).toHaveClass(/sel/);
  await expect(people).toHaveClass(/sel/);
});

// The owner's Captures review, 2026-09-18: a search, Select all with the
// header's tools, a quiet select box, and Clear on the bar's baseline.
test("Captures: search narrows the cards, and the select box waits for the pointer", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "Captures" }).first().click();
  const cards = page.locator(".board-card");
  await expect(cards).toHaveCount(3);
  // the select box is quiet until a card is hovered or a selection has begun
  await page.mouse.move(5, 5);
  await expect(cards.nth(1).locator(".bc-check")).toHaveCSS("opacity", "0");
  await cards.nth(1).hover();
  await expect(cards.nth(1).locator(".bc-check")).toHaveCSS("opacity", "1");

  const search = page.getByRole("searchbox", { name: "Search captures" });
  await search.fill("maria");
  await expect(cards).toHaveCount(1);
  await search.fill("nothing matches this");
  await expect(page.getByText("No matching captures")).toBeVisible();
  await search.fill("");
  await expect(cards).toHaveCount(3);

  // Clear sits on the same line as the bar's actions
  await cards.nth(0).click();
  await expect(cards.nth(2).locator(".bc-check")).toHaveCSS("opacity", "1");
  const clear = (await page.getByRole("button", { name: "Clear", exact: true }).boundingBox())!;
  const archive = (await page.getByRole("button", { name: "Archive" }).boundingBox())!;
  expect(Math.abs(clear.y + clear.height / 2 - (archive.y + archive.height / 2))).toBeLessThan(1.5);
});
