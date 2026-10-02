// Appearance → Theme button and Outline images, and the editor's text
// alignment (`<p align="center">…</p>`, SYNTAX.md). Real controls only: the
// sun, the Settings pills and switch, and the palette's Align commands.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

const sun = (page: Page) => page.getByRole("button", { name: /^Theme — / });

async function appearance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
}

const backToNotes = (page: Page) => page.getByRole("button", { name: "Back to notes", exact: true }).click();

test("the sun flips light and dark by default, and walks only the picks when asked", async ({ page }) => {
  await gotoApp(page);
  await expect(sun(page)).toHaveAccessibleName("Theme — Warm Light · click for Warm Dark");
  await sun(page).click();
  await expect(sun(page)).toHaveAccessibleName("Theme — Warm Dark · click for Warm Light");
  await sun(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await appearance(page);
  await page.getByRole("button", { name: "My picks", exact: true }).click();
  const picks = page.getByRole("group", { name: "Themes the button cycles" });
  await picks.getByRole("button", { name: "Paper", exact: true }).click();
  await picks.getByRole("button", { name: "Midnight", exact: true }).click();
  await expect(picks.getByRole("button", { name: "Midnight", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await backToNotes(page);

  await expect(sun(page)).toHaveAccessibleName("Theme — Warm Light · click for Paper");
  await sun(page).click();
  await expect(sun(page)).toHaveAccessibleName("Theme — Paper · click for Midnight");
  await sun(page).click();
  await expect(sun(page)).toHaveAccessibleName("Theme — Midnight · click for Paper");
});

test("Outline images puts one attribute on the page, and takes it off again", async ({ page }) => {
  await gotoApp(page);
  const html = page.locator("html");
  await expect(html).not.toHaveAttribute("data-outline-images", "true");
  await appearance(page);
  const outline = page.getByRole("switch", { name: /^Outline images/ });
  await expect(outline).toHaveAttribute("aria-checked", "false");
  await outline.click();
  await expect(html).toHaveAttribute("data-outline-images", "true");
  await outline.click();
  await expect(html).not.toHaveAttribute("data-outline-images", "true");
});

async function runAction(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill(title);
  await page.locator(".prow", { hasText: title }).first().click();
}

test("Align center wraps the paragraph, renders it centered with its marks, and Align left unwraps it", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("Align plan\n\nCentered words with **bold** inside\nAfter line");

  await page.locator(".cm-line", { hasText: "Centered words with" }).click();
  await runAction(page, "Align center");
  await page.locator(".cm-line", { hasText: "After line" }).click();

  const centered = page.locator(".cm-line.rotli-align-center");
  await expect(centered).toHaveCount(1);
  await expect(centered).toHaveCSS("text-align", "center");
  // caret elsewhere: the tags hide and the bold still renders
  await expect(centered).not.toContainText("<p");
  await expect(centered.locator(".rotli-strong")).toHaveText("bold");
  // caret in the line: the source shows, so it can be edited directly
  await centered.click();
  await expect(centered).toContainText('<p align="center">');

  await runAction(page, "Align left");
  await page.locator(".cm-line", { hasText: "After line" }).click();
  await expect(page.locator(".cm-line.rotli-align-center")).toHaveCount(0);
  await expect(editor).not.toContainText("<p");
});
