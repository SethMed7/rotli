// The Graph is a development-build feature until it ships (the owner,
// 2026-10-08; lib/featurePolicy.ts `graph`). Rotli Web is a production build,
// so ⌘K offers no Graph and a note's menu has no "Show in graph". The folder
// adapter's Librarian links are proved in services/folderNotes.test.ts and the
// Graph itself in e2e/graph-view.spec.ts (a development build).

import { expect, test } from "@playwright/test";

import { startWithFolder } from "./support";

test("a production build offers no Graph", async ({ page }) => {
  await startWithFolder(page, {
    "Pricing.md": "# Pricing\n\nSee [[Review]].\n",
    "Review.md": "# Review\n\nNo links back.\n",
  });
  await page.locator(".main-tree, .sb-notes-tree").first().waitFor();
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  const search = page.getByPlaceholder("Search notes, files, chats, actions…");
  // the palette answers first, so the absence below isn't read off an empty list
  await search.fill("Pricing");
  await expect(page.locator(".prow", { hasText: "Pricing" }).first()).toBeVisible();
  await search.fill("Graph");
  await expect(page.locator(".prow", { hasText: "Graph of all notes" })).toHaveCount(0);
  await expect(page.locator(".prow", { hasText: "Show this note in the graph" })).toHaveCount(0);
});
