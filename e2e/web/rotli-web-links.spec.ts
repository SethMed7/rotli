// A [[link]] the picker writes must open on the web. When two notes share a
// title the picker writes the note's id, and a note with no frontmatter id is
// identified by its path — `.md` included (2026-09-23: such a link read "No
// note with this name" in Rotli Web).

import { expect, test } from "@playwright/test";

import { startWithFolder } from "./support";

test("a link to one of two same-titled notes, written as its path, opens that note", async ({ page }) => {
  await startWithFolder(page, {
    "links.md": "# Links\n\nSee [[From this browser/Welcome/AI and privacy.md]] for the copy.\n",
    "Welcome/AI and privacy.md": "# AI and privacy\n\nThe lesson.\n",
    "From this browser/Welcome/AI and privacy.md": "# AI and privacy\n\nThe copy from this browser.\n",
  });
  await page.locator(".main-tree, .sb-notes-tree").first().waitFor();
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Links");
  await page.locator(".prow", { hasText: "Links" }).first().click();

  const link = page.locator(".cm-content .rotli-wikilink").first();
  await expect(link).toBeVisible();
  await expect(link).not.toHaveClass(/rotli-wikilink-missing/);
  await link.click();
  await expect(page.locator(".cm-content").first()).toContainText("The copy from this browser.");
});
