// Rename in place (the owner, 2026-09-28: "rename happen in line like how it
// happens in an IDE"). A Main folder's Rename… edits just its row — the notes
// inside stay in view — and a note's Rename… edits its own row instead of
// opening a dialog. Enter saves; Escape keeps the old name.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

/** A folder "Trips" holding "Packing list", and "Loose ends" at the root. */
async function seedMain(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const mounted = (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => new URL(name).pathname === path);
      if (!url) throw new Error(`${path} is not mounted`);
      return import(/* @vite-ignore */ url);
    };
    const [
      { notesService },
      { invalidateNotes },
      { useMainStore },
      { addNoteToMain, fileNoteInNamedRootFolder },
      { DEST },
    ] = await Promise.all([
      mounted("/src/services/notes.ts"),
      mounted("/src/services/hooks.ts"),
      mounted("/src/state/main.ts"),
      mounted("/src/services/mainTree.ts"),
      mounted("/src/services/destinations.ts"),
    ]);
    const packing = await notesService.createNote(DEST.inbox, "# Packing list\n\nPassport.");
    const loose = await notesService.createNote(DEST.inbox, "# Loose ends\n\nCall back.");
    await invalidateNotes();
    const main = useMainStore.getState();
    main.setTree(addNoteToMain(fileNoteInNamedRootFolder(main.manifest.tree, packing.id, "Trips"), loose.id));
  });
}

const row = (page: Page, text: string) => page.locator(".main-tree .main-row", { hasText: text });

test("renaming a Main folder edits its row in place, and what's inside stays in view", async ({ page }) => {
  await gotoApp(page);
  await seedMain(page);
  await expect(row(page, "Packing list")).toBeVisible();

  await row(page, "Trips").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename folder…" }).click();
  const input = page.locator(".main-tree").getByRole("textbox", { name: "Rename Main folder" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Trips");
  // the folder's contents never disappear while its name is edited
  await expect(row(page, "Packing list")).toBeVisible();

  await input.fill("Travel");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(row(page, "Travel")).toBeVisible();
  await expect(row(page, "Packing list")).toBeVisible();
});

test("renaming a note edits its row, not a dialog; Escape keeps the old name", async ({ page }) => {
  await gotoApp(page);
  await seedMain(page);

  await row(page, "Loose ends").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await expect(page.getByRole("dialog", { name: "Rename note" })).toHaveCount(0);
  const input = page.locator(".main-tree").getByRole("textbox", { name: "Rename note" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Loose ends");
  await input.fill("Something else");
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(row(page, "Loose ends")).toBeVisible();

  await row(page, "Loose ends").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await input.fill("Follow-ups");
  await input.press("Enter");
  await expect(row(page, "Follow-ups")).toBeVisible();
  await expect(row(page, "Loose ends")).toHaveCount(0);
});
