import { expect, test } from "@playwright/test";

import { plantOpfsBinary, readOpfsFile, startWithFolder } from "./support";

// A real 1×1 PNG. Synthetic files only.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// An Obsidian vault opened in place (no Rotli marker): the person's own image
// links show, in every form Obsidian writes, and reading them never rewrites
// the note (owner rule 2026-10-13).
test("an Obsidian vault's images show in every form and the note is never rewritten", async ({ page }) => {
  const note = "# Roses\n\n![](img/rose.png)\n\n![[bloom.png]]\n\n![](old/stem.png)\n";
  await startWithFolder(page, { "Garden/Roses.md": note });
  await plantOpfsBinary(page, {
    "Garden/img/rose.png": PNG, // relative to the note
    "attachments/bloom.png": PNG, // Obsidian's ![[name]] finds it anywhere
    "Garden/pics/stem.png": PNG, // the link is stale; the file is found by name
  });
  await page.reload();
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Roses");
  await page.locator(".prow", { hasText: "Roses" }).first().click();

  const editor = page.locator(".pane.focused .cm-content");
  await expect(editor.locator('img[src^="blob:"]')).toHaveCount(3);
  await expect(editor.locator(".rotli-img.missing")).toHaveCount(0);
  expect(await readOpfsFile(page, "Garden/Roses.md")).toBe(note);
});

test("an Obsidian ![[file]] embed mounts the live sheet, wherever the file lives", async ({ page }) => {
  const note = "# Plan\n\n![[budget.csv]]\n\nEnd.\n";
  await startWithFolder(page, { "Notes/Plan.md": note, "Finance/budget.csv": "Item,Cost\nSeeds,12\n" });
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Plan");
  await page.locator(".prow", { hasText: "Plan" }).first().click();

  const sheet = page.locator('.pane.focused .rotli-render-embed[data-lang="sheet"]');
  await expect(sheet).toHaveCount(1);
  await expect(sheet.locator("canvas").first()).toBeVisible();
  expect(await readOpfsFile(page, "Notes/Plan.md")).toBe(note);
});
