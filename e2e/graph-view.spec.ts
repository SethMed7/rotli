// The Graph view (exploration 2026-10-05). Outside the Mac app the Links
// projection runs in TypeScript (services/webLinks.ts, the corpus_links.rs
// twin), so this spec proves the same graph Rotli Web shows. The demo corpus
// links a few notes with [[wikilinks]], and its Librarian-filed note carries
// two related notes the Librarian found; nothing else about a note changes.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 860 } });

test("⌘K opens the whole-vault graph; a note's menu opens the notes around it", async ({ page }) => {
  await gotoApp(page);

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Graph");
  await page.locator(".prow", { hasText: "Graph of all notes" }).first().click();

  const head = page.locator(".graph .board-head");
  await expect(head.locator(".board-title")).toHaveText("Graph");
  // six written links among live notes (the one into Archive draws nothing)
  // plus the Librarian's two, which show by default and say so
  await expect(head.locator(".board-count")).toContainText("· 8 links · 2 from the Librarian");
  await expect(page.getByRole("application", { name: /Graph of \d+ notes and 8 links/ })).toBeVisible();
  // the whole-vault scope adds only the Librarian switch beside the search
  await expect(head.locator(".graph-scope")).toHaveCount(0);
  const librarian = head.getByRole("button", { name: "Librarian links" });
  await expect(librarian).toHaveAttribute("aria-pressed", "true");
  // switched off, only what a person wrote is left
  await librarian.click();
  await expect(librarian).toHaveAttribute("aria-pressed", "false");
  await expect(head.locator(".board-count")).toHaveText(/· 6 links$/);
  await librarian.click();
  await expect(head.locator(".board-count")).toContainText("· 2 from the Librarian");

  // back to the notes, then a note's own menu centers the graph on it
  await page.getByRole("button", { name: "Back to notes" }).click();
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Q3 platform review" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in graph" }).click();
  await expect(head.locator(".graph-scope-label")).toContainText("Around Q3 platform review — prep");
  // its two written links, plus the Librarian's checklist that names it and Pricing
  await expect(head.locator(".board-count")).toHaveText("4 notes · 4 links · 2 from the Librarian");

  // two steps reach the notes its neighbors link (Pricing → the welcome note)
  await head.getByRole("button", { name: "Show 2 steps" }).click();
  await expect(head.locator(".board-count")).toHaveText("5 notes · 5 links · 2 from the Librarian");

  // the keyboard reaches every note: an arrow lands on the center, Enter opens it
  const canvas = page.getByRole("application", { name: /Graph of/ });
  await canvas.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".graph-live")).toHaveText("Q3 platform review — prep, 2 links");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Q3 platform review");
  await expect(page.locator(".graph")).toHaveCount(0);
});

test("searching highlights in place and a scope with no links says how to make one", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Groceries" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in graph" }).click();
  await expect(page.locator(".graph .board-count")).toHaveText("1 note · 0 links");
  await expect(page.locator(".graph-message")).toContainText("Type [[ in a note to link another one.");

  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await expect(page.locator(".graph-scope")).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Find a note" });
  await search.fill("pricing");
  // search never removes dots, so the counts hold
  await expect(page.locator(".graph .board-count")).toContainText("· 8 links");
});
