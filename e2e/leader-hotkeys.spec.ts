// Two-step hotkeys (1.3.0): ⌘⇧W then ⌘number picks a view, ⌘⇧S then ⌘number
// opens one of the top root notes. This spec is ABOUT chords, so — like
// tab-hotkeys.spec.ts — it presses them; every other spec clicks real controls.

import { expect, type Page, test } from "@playwright/test";

import { gotoApp } from "./support";

async function newNote(page: Page, title: string): Promise<void> {
  await page.keyboard.press("Meta+T");
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText(`# ${title}\n`);
  await expect(page.locator(".main-tree .main-row", { hasText: title }).first()).toBeVisible();
}

test("⌘⇧S numbers the top Main notes; ⌘number opens one, then ⌘number is a tab jump again", async ({
  page,
}) => {
  await gotoApp(page);
  await newNote(page, "Slot alpha");
  await newNote(page, "Slot beta");
  const slots = page.locator(".main-tree .main-slot-n");
  await expect(slots).toHaveCount(0);

  await page.keyboard.press("Meta+Shift+S");
  await expect(slots).toHaveText(["⌘1", "⌘2"]);
  const first = page.locator('.main-tree [data-main-slot="1"] .snt');
  const firstTitle = (await first.innerText()).trim();

  await page.keyboard.press("Meta+1");
  await expect(slots).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText(firstTitle);

  // the leader is spent: ⌘1 is the first TAB now, which is not that note
  const firstTab = (await page.getByRole("tab").first().innerText()).trim();
  await page.keyboard.press("Meta+1");
  await expect(page.getByRole("tab", { selected: true })).toContainText(firstTab);
});

test("Esc and an unrelated chord both stand the leader down", async ({ page }) => {
  await gotoApp(page);
  await newNote(page, "Slot gamma");
  const slots = page.locator(".main-tree .main-slot-n");

  await page.keyboard.press("Meta+Shift+S");
  await expect(slots).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(slots).toHaveCount(0);
  // Esc was the leader's: the app is still here
  await expect(page.locator(".main-tree")).toBeVisible();

  await page.keyboard.press("Meta+Shift+S");
  await expect(slots).toHaveCount(1);
  await page.keyboard.press("Meta+T");
  await expect(slots).toHaveCount(0);
});

test("⌘⇧W opens the numbered view menu; ⌘number switches view, even from the Chat front", async ({
  page,
}) => {
  await gotoApp(page);
  const switcher = page.getByRole("button", { name: /Current view:/ });
  await switcher.click();
  await page.getByRole("menu").getByRole("menuitem", { name: "New view…" }).click();
  await page.getByRole("textbox", { name: "New view" }).fill("Work");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(switcher).toHaveAccessibleName(/Current view: Work/);

  await page.keyboard.press("Meta+Shift+W");
  const menu = page.getByRole("menu");
  await expect(menu.locator(".ctxmenu-hint")).toHaveText(["⌘1", "⌘2"]);
  // the hint is decoration: the choice is still named "Work"
  await expect(menu.getByRole("menuitemcheckbox", { name: "Work", exact: true })).toBeVisible();
  await page.keyboard.press("Meta+1");
  await expect(menu).toHaveCount(0);
  await expect(switcher).toHaveAccessibleName(/Current view: Main/);

  await page.keyboard.press("Meta+Shift+W");
  await page.keyboard.press("Meta+2");
  await expect(switcher).toHaveAccessibleName(/Current view: Work/);

  // an empty slot does nothing but close the menu
  await page.keyboard.press("Meta+Shift+W");
  await page.keyboard.press("Meta+7");
  await expect(menu).toHaveCount(0);
  await expect(switcher).toHaveAccessibleName(/Current view: Work/);

  // from the Chat front the hotkey brings Home back, then answers
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(switcher).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+W");
  await expect(menu.locator(".ctxmenu-hint")).toHaveText(["⌘1", "⌘2"]);
  await page.keyboard.press("Meta+1");
  await expect(switcher).toHaveAccessibleName(/Current view: Main/);

  // opened by pointer, the same menu carries no numbers
  await switcher.click();
  await expect(menu.locator(".ctxmenu-hint")).toHaveCount(0);
  await page.keyboard.press("Escape");
});
