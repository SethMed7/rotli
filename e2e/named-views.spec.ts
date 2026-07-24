// Named-view regression: Main remains the global reference view, while a
// compact switcher selects one additional organization tree. Creation targets
// the active view and right-click assignment never removes the Main reference.

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test("named views keep Main global and make Command-T context-sensitive", async ({ page }) => {
  await gotoApp(page);

  const viewSwitcher = page.getByRole("button", { name: /Current view: Main/ });
  await viewSwitcher.scrollIntoViewIfNeeded();
  await viewSwitcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("OpenSource");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: /Current view: OpenSource/ })).toBeVisible();
  await page.keyboard.press("Meta+T");
  await expect(
    page.locator('.main-tree[data-active-view="OpenSource"] [data-main-id]', { hasText: "Untitled" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Current view: OpenSource/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Main — all items" }).click();
  await expect(
    page.locator('.main-tree[data-active-view="Main"] [data-main-id]', { hasText: "Untitled" }),
  ).toBeVisible();

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: "Q3 priorities — Myela" });
  await source.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Move to view" }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "OpenSource" }).click();

  await page.getByRole("button", { name: /Current view: Main/ }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "OpenSource" }).click();
  const projected = page.locator('.main-tree[data-active-view="OpenSource"] [data-main-id]', {
    hasText: "Q3 priorities — Myela",
  });
  await expect(projected).toBeVisible();
  await projected.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Remove from OpenSource" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Move to Trash" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Copy File Path" })).toBeDisabled();
});
