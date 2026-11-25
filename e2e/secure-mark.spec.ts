// A secure note wears one quiet shield in its rows (2026-11-24): the Main tree
// and the All notes list, named "Secure note", never in the way. The browser twin
// has no Secure lane to flip, so the note is seeded secure through the app's own
// service and its flag is changed the same way; the mark must follow the list.
// Native proof of the Rust list flag is the cargo suite (corpus_list_secure_tests).

import { expect, type Page, test } from "@playwright/test";

import { gotoApp } from "./support";

test.use({ viewport: { width: 1100, height: 760 } });

const TITLE = "Passport and visa checklist";

/** Import the module instances React mounted, so the test drives the live stores. */
async function seedSecureNoteInMain(page: Page): Promise<string> {
  return page.evaluate(async (title) => {
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
    const note = await notesService.createNote("Inbox", `# ${title}\n\nsynthetic body for the test\n`, {
      secure: true,
    });
    await invalidateNotes();
    const main = useMainStore.getState();
    main.setTree(addNoteToMain(main.manifest.tree, note.id));
    return note.id as string;
  }, TITLE);
}

async function setSecureFlag(page: Page, id: string, secure: boolean): Promise<void> {
  await page.evaluate(
    async ({ id: noteId, secure: flag }) => {
      const mounted = (path: string) => {
        const url = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => new URL(name).pathname === path);
        if (!url) throw new Error(`${path} is not mounted`);
        return import(/* @vite-ignore */ url);
      };
      const [{ notesService }, { invalidateNotes }] = await Promise.all([
        mounted("/src/services/notes.ts"),
        mounted("/src/services/hooks.ts"),
      ]);
      const note = (notesService as unknown as { notes: Map<string, { secure?: boolean }> }).notes.get(
        noteId,
      );
      if (!note) throw new Error("seeded note is gone");
      if (flag) note.secure = true;
      else delete note.secure;
      await invalidateNotes();
    },
    { id, secure },
  );
}

test("a secure note wears the quiet shield in Main and All notes, and it follows the flag", async ({
  page,
}) => {
  await gotoApp(page);
  const id = await seedSecureNoteInMain(page);

  const mainRow = page.locator(".main-tree .main-row", { hasText: TITLE });
  await expect(mainRow).toBeVisible();
  const mark = mainRow.getByRole("img", { name: "Secure note" });
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute("title", "Secure note");
  // plain notes in the same tree carry none
  await expect(page.locator(".main-tree").getByRole("img", { name: "Secure note" })).toHaveCount(1);

  // quiet: the title still truncates and the star keeps its place on hover
  const star = mainRow.locator(".mstar");
  const before = await star.boundingBox();
  await mainRow.hover();
  const after = await star.boundingBox();
  expect(after?.x).toBe(before?.x);
  const title = mainRow.locator(".snt");
  expect(await title.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const listRow = page.locator(".recent-row", { hasText: TITLE });
  await expect(listRow.getByRole("img", { name: "Secure note" })).toBeVisible();
  await page.screenshot({ path: "_review/boards-chats-2026-11-24/secure-mark-after.png" });

  // the flag turns off: the shield goes everywhere at once, then comes back
  await setSecureFlag(page, id, false);
  await expect(page.getByRole("img", { name: "Secure note" })).toHaveCount(0);
  await setSecureFlag(page, id, true);
  await expect(listRow.getByRole("img", { name: "Secure note" })).toBeVisible();
});
