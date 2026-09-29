// Tester feedback, 2026-09-29: "if I use / and tap on insert but want to go
// back or unfocus, the window would still appear." A slash command's panel (a
// note picker, a template picker, the image panel) closes when you click back
// into the note, and Escape from the note closes it too.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

async function openSlashItem(page: Page, item: RegExp): Promise<void> {
  await gotoApp(page);
  await page
    .getByRole("button", { name: /^New .* tab/ })
    .first()
    .click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.insertText("# Panels\n\nSome text here.\n\n");
  await page.keyboard.type("/");
  await page.getByRole("menu", { name: "Insert block" }).getByRole("menuitem", { name: item }).click();
}

test("a slash picker closes when you click back into the note", async ({ page }) => {
  await openSlashItem(page, /^Link note/);
  const picker = page.locator(".slashpicker");
  await expect(picker).toBeVisible();
  await page.locator(".cm-line", { hasText: "Some text here." }).click();
  await expect(picker).toHaveCount(0);
});

test("the image panel closes on Escape after you click back into the note", async ({ page }) => {
  await openSlashItem(page, /^Generate image/);
  const panel = page.getByRole("dialog", { name: "Generate image" });
  await expect(panel).toBeVisible();
  await page.locator(".cm-line", { hasText: "Some text here." }).click();
  await expect(panel).toHaveCount(0);
  // and Escape closes it when focus never left the note
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await page
    .getByRole("menu", { name: "Insert block" })
    .getByRole("menuitem", { name: /^Generate image/ })
    .click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
