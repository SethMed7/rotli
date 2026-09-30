// The owner, 2026-09-29: "add slash commands that do a date like yesterday,
// today, tomorrow", a function command that continues a project's task list
// (link it while work is open, start its next note when it's all done), and a
// Link note picker that makes the note you type, closes on Esc or its ×, and
// scrolls with the arrow keys.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

async function newNote(page: Page, text: string): Promise<void> {
  await page
    .getByRole("button", { name: /^New .* tab/ })
    .first()
    .click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.insertText(text);
}

async function slash(page: Page, item: RegExp): Promise<void> {
  await page.keyboard.type("/");
  await page.getByRole("menu", { name: "Insert block" }).getByRole("menuitem", { name: item }).click();
}

test("/today writes today's date into the note", async ({ page }) => {
  await gotoApp(page);
  await newNote(page, "# Standup\n\n");
  await slash(page, /^Today/);
  const today = await page.evaluate(() =>
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  );
  await expect(page.locator(".pane.focused .cm-content")).toContainText(today);
});

test("the slash menu scrolls with the arrow keys", async ({ page }) => {
  await gotoApp(page);
  await newNote(page, "# Arrows\n\n");
  await page.keyboard.type("/");
  const menu = page.getByRole("menu", { name: "Insert block" });
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => menu.evaluate((el) => el.scrollTop)).toBe(0);
  // up from the first row wraps to the last one, which sits below the fold
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const last = menu.locator(".slashrow.sel");
  await expect(last).toBeInViewport();
});

test("Link note makes the note you type and links it", async ({ page }) => {
  await gotoApp(page);
  await newNote(page, "# Plans\n\n");
  await slash(page, /^Link note/);
  const picker = page.locator(".slashpicker");
  await page.keyboard.type("Zebra crossing notes");
  const create = picker.getByRole("menuitem", { name: /Create “Zebra crossing notes”/ });
  await expect(create).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".pane.focused .cm-content")).toContainText("Zebra crossing notes");
  await expect(page.locator(".main-row", { hasText: "Zebra crossing notes" })).toBeVisible();
});

test("the Link note picker closes on Escape and on its ×", async ({ page }) => {
  await gotoApp(page);
  await newNote(page, "# Plans\n\n");
  await slash(page, /^Link note/);
  const picker = page.locator(".slashpicker");
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  await slash(page, /^Link note/);
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Close link note" }).click();
  await expect(picker).toHaveCount(0);
});

async function seedNote(page: Page, body: string): Promise<void> {
  await page.evaluate(async (text) => {
    const mounted = (path: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => new URL(name).pathname === path);
      if (!url) throw new Error(`${path} is not mounted`);
      return import(/* @vite-ignore */ url);
    };
    const [{ notesService }, { invalidateNotes }, { DEST }] = await Promise.all([
      mounted("/src/services/notes.ts"),
      mounted("/src/services/hooks.ts"),
      mounted("/src/services/destinations.ts"),
    ]);
    await notesService.createNote(DEST.inbox, text);
    await invalidateNotes();
  }, body);
}

test("Continue a project list starts the next note when every task is done", async ({ page }) => {
  await gotoApp(page);
  await seedNote(page, "# Bug fixes 3\n\n- [x] Crash on launch\n- [x] Slow search\n");
  await newNote(page, "# Today's work\n\n");
  await slash(page, /^Continue a project list/);
  await page.keyboard.type("Bug fixes 3");
  await page
    .locator(".slashpicker")
    .getByRole("menuitem", { name: /Bug fixes 3/ })
    .click();
  await expect(page.locator(".pane.focused .cm-content")).toContainText("Bug fixes 4");
  await expect(page.locator(".main-row", { hasText: "Bug fixes 4" })).toBeVisible();
});

test("Continue a project list links the list itself while work is open", async ({ page }) => {
  await gotoApp(page);
  await seedNote(page, "# Enhancements\n\n- [x] Dark mode\n- [ ] Export to PDF\n");
  await newNote(page, "# Today's work\n\n");
  await slash(page, /^Continue a project list/);
  await page.keyboard.type("Enhancements");
  await page
    .locator(".slashpicker")
    .getByRole("menuitem", { name: /Enhancements/ })
    .click();
  await expect(page.locator(".pane.focused .cm-content")).toContainText("Enhancements");
  await expect(page.locator(".main-row", { hasText: "Enhancements 2" })).toHaveCount(0);
});

// Found by the computer-use pass, 2026-09-29: in a short window the menu ran
// past the window's bottom, and arrowing to a row below the fold scrolled the
// NOTE (scrollIntoView moves every scrollable ancestor), pushing the menu's top
// under the tab strip. The menu now fits the room it has and only it scrolls.
test("in a short window the slash menu fits, and arrowing scrolls only the menu", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  await gotoApp(page);
  await newNote(page, "# Short\n\nOne.\n\nTwo.\n\n");
  const scroller = page.locator(".pane.focused .cm-scroller");
  const before = await scroller.evaluate((el) => el.scrollTop);
  await page.keyboard.type("/");
  const menu = page.getByRole("menu", { name: "Insert block" });
  await expect(menu).toBeVisible();
  const fits = () =>
    menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight;
    });
  expect(await fits()).toBe(true);
  await page.keyboard.press("ArrowUp");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  await expect(menu.locator(".slashrow.sel")).toBeInViewport();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(before);
  expect(await fits()).toBe(true);
});
