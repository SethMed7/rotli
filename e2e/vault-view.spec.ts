// The Vault view (the owner, 2026-09-30: "add 'vault' as a view, so they can
// see things just how they are in Finder"). Main stays the default; picking
// Vault shows the vault's own folders, read-only, and Main comes back.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the view picker offers Vault: the vault's folders as on disk, then back to Main", async ({ page }) => {
  await gotoApp(page);
  const switcher = () => page.getByRole("button", { name: /Current view: / });
  await expect(switcher()).toHaveAccessibleName(/Current view: Main/);

  await switcher().click();
  await page
    .getByRole("menu")
    .getByRole("menuitemcheckbox", { name: /^Vault/ })
    .click();
  await expect(switcher()).toHaveAccessibleName(/Current view: Vault/);

  // the disk's folders, closed until opened (a big vault doesn't unfold at once)
  const tree = page.locator('.main-tree[data-active-view="Main"], .main-tree');
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

  // back to Main
  await switcher().click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: /^Main/ }).click();
  await expect(switcher()).toHaveAccessibleName(/Current view: Main/);
  await expect(page.getByRole("button", { name: /^New folder in Main/ })).toBeEnabled();
});
