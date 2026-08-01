// Regression for the Main creation context: opening a Main reference must make
// that virtual folder the target for Command-T. The note itself still lives in
// the memex intake lane; Main receives an immediate reference.

import { expect, test } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test("Command-T from a Main note creates a new note in Main immediately", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: "Q3 priorities — Myela" });
  const mainRoot = page.locator('[data-main-id="main:"]');
  await pointerDrag(page, source, await centerOf(mainRoot));

  const mainNote = page.locator(".main-tree [data-main-id]", { hasText: "Q3 priorities — Myela" });
  await mainNote.click();

  const tabs = page.getByRole("tab");
  const countBefore = await tabs.count();
  await page.keyboard.press("Meta+T");

  await expect(tabs).toHaveCount(countBefore + 1);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Untitled");
  await expect(page.locator(".main-tree [data-main-id]", { hasText: "Untitled" })).toBeVisible();
});

test("browsing reuses one preview tab; re-click keeps; typing keeps", async ({ page }) => {
  await gotoApp(page);
  // measure the strip while the PANES are visible (All-notes hides them)
  const tabs = page.locator(".tabslot");
  const before = await tabs.count();
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();

  // click through two notes — ONE preview tab absorbs both
  await page.locator(".recent-row", { hasText: "Groceries" }).click();
  await expect(tabs).toHaveCount(before + 1);
  await expect(page.locator(".tab.preview")).toHaveCount(1);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Quokka world" }).click();
  await expect(tabs).toHaveCount(before + 1); // reused, not appended

  // clicking the same note again KEEPS the tab
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Quokka world" }).click();
  await expect(page.locator(".tab.preview")).toHaveCount(0);

  // the next browse gets a fresh preview tab beside the kept one
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Groceries" }).click();
  await expect(tabs).toHaveCount(before + 2);

  // typing into the previewed note keeps it too
  await page.locator(".cm-content").last().click();
  await page.keyboard.type("x");
  await expect(page.locator(".tab.preview")).toHaveCount(0);
});
