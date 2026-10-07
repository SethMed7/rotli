// The Graph on Rotli Web, proved against a real folder: the links a note's
// body writes are lines, and the one-line frontmatter `links:` the Librarian
// writes is read by the folder adapter and drawn as Librarian links
// (owner decision 2026-10-06). Nothing about a file changes.

import { expect, test } from "@playwright/test";

import { readOpfsFile, startWithFolder } from "./support";

const CHECKLIST = "---\nlinks: [[Pricing]], [[Review]]\n---\n# Checklist\n\nWhat ships.\n";

test("a folder vault's written links and the Librarian's links both reach the graph", async ({ page }) => {
  await startWithFolder(page, {
    "Pricing.md": "# Pricing\n\nSee [[Review]].\n",
    "Review.md": "# Review\n\nNo links back.\n",
    "Checklist.md": CHECKLIST,
  });
  await page.locator(".main-tree, .sb-notes-tree").first().waitFor();
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Graph");
  await page.locator(".prow", { hasText: "Graph of all notes" }).first().click();

  const count = page.locator(".graph .board-count");
  await expect(count).toHaveText(/3 notes · 3 links · 2 from the Librarian/);
  await page.getByRole("button", { name: "Librarian links" }).click();
  await expect(count).toHaveText(/3 notes · 1 link$/);
  // the graph read the file; it never wrote it
  expect(await readOpfsFile(page, "Checklist.md")).toBe(CHECKLIST);
});
