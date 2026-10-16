// Raw data (the owner, 2026-09-30: "see things just how they are in Finder";
// 2026-10-10: not one more view, but "in the views when you click you have an
// option to view data raw … which can also be done in settings"). It sits
// apart in the views menu, shows the vault's own folders read-only, and any
// view brings the views back.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the views menu offers Raw data apart from the views, and a view brings Main back", async ({ page }) => {
  await gotoApp(page);
  const switcher = () => page.getByRole("button", { name: /Current view: / });
  await expect(switcher()).toHaveAccessibleName(/Current view: Main/);
  // in Views the System zone's Library is the way to browse the vault as on disk
  const library = page.locator(".sb-system .frow", { hasText: "Library" });
  await expect(library).toBeVisible();

  await switcher().click();
  await page
    .getByRole("menu")
    .getByRole("menuitemcheckbox", { name: /^Raw data/ })
    .click();
  await expect(switcher()).toHaveAccessibleName(/Current view: Raw data/);
  // in Raw data the sidebar already is that, so the Library row steps aside
  await expect(library).toHaveCount(0);

  // the disk's folders, closed until opened (a big vault doesn't unfold at once)
  const tree = page.locator(".main-tree");
  const folder = tree.locator(".frow.main-row", { hasText: "Projects" });
  await expect(folder).toBeVisible();
  // it IS the disk: nothing to arrange here
  await expect(
    page.locator(".fsec-hdr").getByRole("button", { name: "New folder", exact: true }),
  ).toBeDisabled();
  // no external-vault markers or opaque ids among the folders
  await expect(tree.locator(".frow.main-row", { hasText: /vault:|^[0-9A-Z]{26}$/ })).toHaveCount(0);
  await folder.click();
  await expect(tree.locator("[data-note-id]").first()).toBeVisible();

  // any view leaves Raw data
  await switcher().click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: /^Main/ }).click();
  await expect(switcher()).toHaveAccessibleName(/Current view: Main/);
  await expect(page.getByRole("button", { name: /^New folder in Main/ })).toBeEnabled();
  await expect(library).toBeVisible();
});

test("Settings → Appearance → Notes switches between Views and Raw data", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const notes = page.locator(".segfield", { hasText: "Notes" });
  await notes.getByRole("button", { name: "Raw data", exact: true }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(page.getByRole("button", { name: /Current view: Raw data/ })).toBeVisible();
});
