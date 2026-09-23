// A link can open a note Main doesn't hold; the sidebar still shows where you
// are — the row the note lives under wears the highlight (2026-09-23).

import { expect, test } from "@playwright/test";

import { plantOpfsFiles, startWithVault } from "./support";

test("following a link to a Library-only note highlights Library, not the note you left", async ({
  page,
}) => {
  await startWithVault(page);
  await plantOpfsFiles(page, { "wiki/Loose note.md": "# Loose note\n\nOnly in the Library.\n" });
  await page.reload();
  const welcome = page.locator(".main-tree [data-main-id]", { hasText: "Welcome to Rotli" }).first();
  await welcome.click();
  await expect(welcome).toHaveClass(/\bsel\b/);

  await page.locator(".pane.focused .cm-content .cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("See [[Loose note]] here");
  await page.keyboard.press("ArrowUp");
  await page.locator(".cm-content .rotli-wikilink", { hasText: "Loose note" }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Loose note");

  const library = page.locator(".sb-system .frow", { hasText: "Library" });
  await expect(library).toHaveClass(/\bsel\b/);
  await expect(library).toHaveAttribute("aria-current", "location");
  await expect(welcome).not.toHaveClass(/\bsel\b/);

  // back in a Main note, Main's row holds the highlight again
  await welcome.click();
  await expect(welcome).toHaveClass(/\bsel\b/);
  await expect(library).not.toHaveAttribute("aria-current", "location");
});
