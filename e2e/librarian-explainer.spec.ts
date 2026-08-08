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
