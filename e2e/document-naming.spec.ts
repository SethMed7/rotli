// Documents are named like boards: a name before the file exists, and Rename…
// from the same row and tab menus a note offers. Browser mode cannot write a
// real .docx, so the rename test seeds one file row into the in-memory corpus
// (the browser twin of the Rust walk) and drives every control for real.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

test("a new Document asks for its name before creation", async ({ page }) => {
  await gotoApp(page);
  const tabsBefore = await page.getByRole("tab").count();

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await page.locator(".ni-surface").getByRole("button", { name: "New Document" }).click();

  const dialog = page.getByRole("dialog", { name: "Name document" });
  await expect(dialog).toBeVisible();
  const name = dialog.getByRole("textbox", { name: "Document name" });
  await expect(name).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Create document" })).toBeDisabled();
  await name.fill("Quarterly plan");
  await expect(dialog.getByRole("button", { name: "Create document" })).toBeEnabled();

  // cancelling before creation leaves nothing behind — not even a tab
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(tabsBefore);
  await expect(page.getByRole("tab", { name: /\.docx|Document/ })).toHaveCount(0);
});

/** Import the module instance React mounted (a reused dev server may serve it
 * under a timestamped URL), so the test drives the live stores. */
async function seedDocumentInMain(page: Page, id: string): Promise<void> {
  await page.evaluate(async (fileId) => {
    const mounted = (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => new URL(name).pathname === path);
      if (!url) throw new Error(`${path} is not mounted`);
      return import(/* @vite-ignore */ url);
    };
    const [{ notesService }, { invalidateNotes }, { useMainStore }, { addNoteToMain }, { usePanesStore }] =
      await Promise.all([
        mounted("/src/services/notes.ts"),
        mounted("/src/services/hooks.ts"),
        mounted("/src/state/main.ts"),
        mounted("/src/services/mainTree.ts"),
        mounted("/src/state/panes.ts"),
      ]);
    notesService.seedFile(fileId);
    await invalidateNotes();
    const main = useMainStore.getState();
    main.setTree(addNoteToMain(main.manifest.tree, fileId));
    usePanesStore.getState().openFile(fileId, { newTab: true });
  }, id);
}

test("a document renames from its Main row and its tab, keeping .docx", async ({ page }) => {
  await gotoApp(page);
  await seedDocumentInMain(page, "storage/rotli/untitled-1789390512692.docx");

  const row = page.locator(".main-tree .main-row", { hasText: "untitled-1789390512692.docx" });
  await expect(row).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toContainText("untitled-1789390512692.docx");

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename document" });
  const input = dialog.getByRole("textbox", { name: "Document name" });
  await expect(input).toBeFocused();
  // seeded with the name, not the extension
  await expect(input).toHaveValue("untitled-1789390512692");
  await input.fill("Quarterly plan");
  await input.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".main-tree .main-row", { hasText: "Quarterly plan.docx" })).toBeVisible();
  await expect(page.locator(".main-tree .main-row", { hasText: "untitled-1789390512692" })).toHaveCount(0);
  const tab = page.getByRole("tab", { selected: true });
  await expect(tab).toContainText("Quarterly plan.docx");

  // the tab's own menu renames too; a taken name is refused with a reason
  await seedDocumentInMain(page, "storage/rotli/Taken.docx");
  await page.getByRole("tab", { name: /Quarterly plan\.docx/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await input.fill("Taken");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await input.fill("Plan v2");
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".main-tree .main-row", { hasText: "Plan v2.docx" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Plan v2\.docx/ })).toBeVisible();
});

test("a board whose tab is closed renames from its Main row", async ({ page }) => {
  await gotoApp(page);
  // a board row in Main with no open tab — the inline rename input only ever
  // lived on the tab strip, so the row's Rename… used to do nothing
  await page.evaluate(async () => {
    const mounted = (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => new URL(name).pathname === path);
      if (!url) throw new Error(`${path} is not mounted`);
      return import(/* @vite-ignore */ url);
    };
    const [{ notesService }, { invalidateNotes }, { useMainStore }, { addNoteToMain }] = await Promise.all([
      mounted("/src/services/notes.ts"),
      mounted("/src/services/hooks.ts"),
      mounted("/src/state/main.ts"),
      mounted("/src/services/mainTree.ts"),
    ]);
    const id = "storage/excalidraw/Rename Board.excalidraw";
    const board = notesService.seedFile(id);
    board.kind = "board";
    board.title = "Rename Board";
    await invalidateNotes();
    const main = useMainStore.getState();
    main.setTree(addNoteToMain(main.manifest.tree, id));
  });

  const row = page.locator(".main-tree .main-row", { hasText: "Rename Board" });
  await expect(row).toBeVisible();
  await expect(page.getByRole("tab", { name: /Rename Board/ })).toHaveCount(0);
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename board" });
  const input = dialog.getByRole("textbox", { name: "Board name" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Rename Board");
});
