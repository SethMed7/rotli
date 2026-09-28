// The Librarian pill (2026-09-28, the owner: "look like it is coming out of
// something … in line with the arrow, to the left of it", then "only show if
// the user runs /librarian"). A plain note has no pill in its corner; the pill
// comes with a /librarian conversation (librarianChat.test.tsx renders it,
// tucked and open), and its place beside the arrow is CSS (.libchat-launch).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("a note shows no Librarian pill until /librarian is run", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText("# Plain note\n\nNothing asked of the Librarian.\n\n");
  await expect(page.locator(".libchat-launch")).toHaveCount(0);
  await page.keyboard.type("/librarian");
  await page
    .getByRole("menu", { name: "Insert block" })
    .getByRole("menuitem", { name: /Talk to the Librarian/ })
    .click();
  await expect(page.getByRole("region", { name: "Librarian" })).toBeVisible();
});
