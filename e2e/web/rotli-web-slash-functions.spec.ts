// The slash dates, the template date token, Link note's Create, and Continue a
// project list on Rotli Web (the owner, 2026-09-29), proved against a real
// folder: the notes they make land on disk, and a template's {{today}} fills
// in the day it is used.

import { expect, test, type Page } from "@playwright/test";

import { startWithFolder } from "./support";

/** Every Markdown file in the connected OPFS vault, path → text. */
function vaultFiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const out: Record<string, string> = {};
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (handle.kind === "directory") await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
        else if (name.endsWith(".md"))
          out[`${prefix}${name}`] = await (await (handle as FileSystemFileHandle).getFile()).text();
      }
    };
    await walk(await navigator.storage.getDirectory(), "");
    return out;
  });
}

async function newNote(page: Page, text: string): Promise<void> {
  await page
    .getByRole("button", { name: /^New .* tab/ })
    .first()
    .click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.insertText(text);
}

/** After text a slash opens the menu only once a letter follows it (prose
 * keeps its slashes), so type the start of the command's name. */
async function slash(page: Page, query: string, item: RegExp): Promise<void> {
  await page.keyboard.type(`/${query}`);
  await page.getByRole("menu", { name: "Insert block" }).getByRole("menuitem", { name: item }).click();
}

const today = (page: Page) =>
  page.evaluate(() =>
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  );

test("a template's {{today}} becomes the day it is used", async ({ page }) => {
  await startWithFolder(page, { "Templates/Daily.md": "# Daily\n\nPlanned for {{today}}.\n\n- [ ] \n" });
  await page.locator(".main-tree, .sb-notes-tree").first().waitFor();
  await newNote(page, "");
  await slash(page, "", /^Template/);
  await page
    .locator(".slashpicker")
    .getByRole("menuitem", { name: /^Daily/ })
    .filter({ hasText: "Daily.md" })
    .click();
  await expect(page.locator(".pane.focused .cm-content")).toContainText(`Planned for ${await today(page)}.`);
});

test("Link note's Create writes the note to the folder and links it", async ({ page }) => {
  await startWithFolder(page, { "Plans.md": "# Plans\n\n" });
  await page.locator(".main-tree, .sb-notes-tree").first().waitFor();
  await newNote(page, "# Trip\n\nSee ");
  await slash(page, "link", /^Link note/);
  await page.keyboard.type("Packing for Lisbon");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pane.focused .cm-content")).toContainText("Packing for Lisbon");
  await expect
    .poll(async () =>
      Object.values(await vaultFiles(page)).some((text) => text.includes("# Packing for Lisbon")),
    )
    .toBe(true);
});

test("Continue a project list writes the next note, linked back, when the list is done", async ({ page }) => {
  await startWithFolder(page, { "Bug fixes 3.md": "# Bug fixes 3\n\n- [x] Crash on launch\n" });
  await page.locator(".main-tree, .sb-notes-tree").first().waitFor();
  await newNote(page, "# Today\n\n");
  await slash(page, "", /^Continue a project list/);
  await page.keyboard.type("Bug fixes 3");
  await page
    .locator(".slashpicker")
    .getByRole("menuitem", { name: /Bug fixes 3/ })
    .click();
  await expect(page.locator(".pane.focused .cm-content")).toContainText("Bug fixes 4");
  await expect
    .poll(async () =>
      Object.values(await vaultFiles(page)).some(
        (text) => text.includes("# Bug fixes 4") && text.includes("Continues [[Bug fixes 3]]."),
      ),
    )
    .toBe(true);
});

test("/today writes the date", async ({ page }) => {
  await startWithFolder(page, { "Log.md": "# Log\n\n" });
  await page.locator(".main-tree, .sb-notes-tree").first().waitFor();
  await newNote(page, "# Standup\n\nShipped on ");
  await slash(page, "tod", /^Today/);
  await expect(page.locator(".pane.focused .cm-content")).toContainText(`Shipped on ${await today(page)}`);
});
