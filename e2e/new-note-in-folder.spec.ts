// The owner, 2026-09-29: "when in a folder and in the file, cmd+t should keep
// the file inside the folder I am in." A new tab's note is filed beside the
// note that was open: into the same Main folder, not Main's root. (The tab
// strip's + runs the same action as ⌘T.)

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("a new note made while a folder's note is open is filed in that folder", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    const mounted = (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => new URL(name).pathname === path);
      if (!url) throw new Error(`${path} is not mounted`);
      return import(/* @vite-ignore */ url);
    };
    const [{ notesService }, { invalidateNotes }, { useMainStore }, { fileNoteInNamedRootFolder }, { DEST }] =
      await Promise.all([
        mounted("/src/services/notes.ts"),
        mounted("/src/services/hooks.ts"),
        mounted("/src/state/main.ts"),
        mounted("/src/services/mainTree.ts"),
        mounted("/src/services/destinations.ts"),
      ]);
    const packing = await notesService.createNote(DEST.inbox, "# Packing list\n\nPassport.");
    await invalidateNotes();
    const main = useMainStore.getState();
    main.setTree(fileNoteInNamedRootFolder(main.manifest.tree, packing.id, "Trips"));
  });

  const trips = page.locator(".main-branch", { has: page.locator(".frow", { hasText: "Trips" }) });
  await trips.locator(".main-row", { hasText: "Packing list" }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Packing list");

  await page
    .getByRole("button", { name: /^New .* tab/ })
    .first()
    .click();
  const editor = page.locator(".pane.focused .cm-content");
  await editor.click();
  await page.keyboard.insertText("# Hotel ideas\n\nNear the harbour.");

  await expect(trips.locator(".main-branch-children .main-row", { hasText: "Hotel ideas" })).toBeVisible();
});
