import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the Librarian explains its file structure and links to deeper controls", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Librarian", exact: true }).click();

  const intro = page.getByRole("dialog", { name: "About the Librarian" });
  await expect(intro).toBeVisible();
  await expect(intro.getByRole("heading", { name: "Where your files go" })).toBeVisible();
  await expect(intro.getByText("Main and named views are references", { exact: false })).toBeVisible();
  await expect(intro.getByRole("button", { name: "Librarian settings" })).toBeVisible();
  await intro.getByRole("button", { name: "Security & privacy" }).click();
  await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(page.getByRole("button", { name: "How the Librarian works" })).toBeVisible();
  await page.getByRole("button", { name: "How the Librarian works" }).click();
  await page
    .getByRole("dialog", { name: "About the Librarian" })
    .getByRole("button", { name: "Got it" })
    .click();
});

test("the Librarian's introduction takes focus and keeps Tab inside it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Librarian", exact: true }).click();
  const intro = page.getByRole("dialog", { name: "About the Librarian" });
  await expect(intro.getByRole("button", { name: "Got it" })).toBeFocused();
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
    expect(await intro.evaluate((card) => card.contains(document.activeElement))).toBe(true);
  }
  // closing puts focus back where it was, not on the page body
  await intro.getByRole("button", { name: "Got it" }).click();
  await expect(intro).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});
