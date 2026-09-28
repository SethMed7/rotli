// Settings → Librarian → Your rules (2026-09-28): secure keywords, how People
// is split, and filing sentences are edited here and kept with the vault's
// settings (the round trip is src/state/persistLibrarian.test.ts; this build
// has no settings file to reload from). Protecting notes already named with a keyword, and every effect of
// the rules on filing, are Mac-only (the Rust organizer and corpus read the
// same settings; proved by their tests and a native check).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

async function openRules(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Librarian", exact: true }).click();
  await page
    .getByRole("dialog", { name: "About the Librarian" })
    .getByRole("button", { name: "Librarian settings" })
    .click();
  const rules = page.getByRole("region", { name: "Your rules" });
  await expect(rules).toBeVisible();
  return rules;
}

test("Librarian rules: keywords, People groups and filing rules are edited in Settings", async ({ page }) => {
  await gotoApp(page);
  let rules = await openRules(page);

  // secure keywords: added as chips; protecting existing notes is the Mac app's
  const keyword = rules.getByRole("textbox", { name: "Add to Secure keywords" });
  await keyword.fill("bank");
  await keyword.press("Enter");
  await expect(rules.getByRole("list", { name: "Secure keywords" })).toContainText("bank");
  await expect(rules.getByText("works in the Mac app")).toBeVisible();

  // People: the default groups; a new one; a bad name says why; one removed
  const groups = rules.getByRole("list", { name: "People groups" });
  await expect(groups).toContainText("Acquaintances");
  const group = rules.getByRole("textbox", { name: "Add to People groups" });
  await group.fill("Neighbors");
  await group.press("Enter");
  await expect(groups).toContainText("Neighbors");
  await group.fill("_hidden");
  await group.press("Enter");
  await expect(rules.getByRole("alert")).toContainText("A group is one plain name");
  await rules.getByRole("button", { name: "Remove “Work”" }).click();
  await expect(groups).not.toContainText("Work");

  // one list hides the groups; switching back keeps them
  await rules.getByRole("button", { name: "One list" }).click();
  await expect(groups).toHaveCount(0);
  await rules.getByRole("button", { name: "Groups" }).click();
  await expect(groups).toContainText("Neighbors");

  // filing rules: plain sentences
  const filing = rules.getByRole("textbox", { name: "Add to Filing rules" });
  await filing.fill("Recipes go to Cooking");
  await filing.press("Enter");
  await expect(rules.getByRole("list", { name: "Filing rules" })).toContainText("Recipes go to Cooking");
});
