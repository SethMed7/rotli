// 2026-09-26: a typed [[Board]] link resolved to the board but opened it as a
// note tab. A link opens its target by kind — a board opens on its canvas.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

/** The browser twin cannot create a board (boards need a vault folder), so
 * the board is seeded the way document-naming.spec.ts seeds one. */
async function seedBoard(page: Page, title: string): Promise<string> {
  return page.evaluate(async (name) => {
    const mounted = (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((entry) => new URL(entry).pathname === path);
      if (!url) throw new Error(`${path} is not mounted`);
      return import(/* @vite-ignore */ url);
    };
    const [{ notesService }, { invalidateNotes }] = await Promise.all([
      mounted("/src/services/notes.ts"),
      mounted("/src/services/hooks.ts"),
    ]);
    const id = `storage/excalidraw/${name}.excalidraw`;
    const board = notesService.seedFile(id);
    board.kind = "board";
    board.title = name;
    await invalidateNotes();
    return id;
  }, title);
}

async function activeTabKind(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((entry) => new URL(entry).pathname === "/src/state/panes.ts");
    if (!url) throw new Error("panes is not mounted");
    const { usePanesStore, findLeaf, activeTabOf } = await import(/* @vite-ignore */ url);
    const { root, focusedPaneId } = usePanesStore.getState();
    const leaf = findLeaf(root, focusedPaneId);
    return leaf ? activeTabOf(leaf)?.surfaceKind : undefined;
  });
}

test("a [[link]] to a board opens the board on its canvas", async ({ page }) => {
  await gotoApp(page);
  await seedBoard(page, "Linked Sketch");

  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText("Board link\n\nSee [[Linked Sketch]] for the layout.\n\nEnd.");
  await page.locator(".cm-line", { hasText: "End." }).click();
  await page.locator(".cm-content").last().getByText("Linked Sketch", { exact: true }).click();

  await expect(page.getByRole("tab", { selected: true })).toContainText("Linked Sketch");
  expect(await activeTabKind(page)).toBe("canvas");
});
