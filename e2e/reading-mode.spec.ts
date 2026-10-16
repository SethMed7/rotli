// Reading mode (the owner, 2026-10-14): focus mode, and the note only to read.
// No typing, no spelling marks, nothing that reacts to the pointer, and the
// beautified view never shows Markdown. Esc leaves it, like focus mode.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("reading mode shows the note beautified, takes no input, and Esc leaves it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New note in / }).click();
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.type("Read me");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Some **bold** words and a speling mistake.");

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Reading mode");
  await page.locator(".prow", { hasText: "Reading mode" }).click();

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-reading", "true");
  await expect(root).toHaveAttribute("data-focus", "true"); // the chrome leaves, as in focus mode
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(editor).toHaveAttribute("spellcheck", "false");
  // beautified with no caret: the line that held the caret shows no Markdown either
  await expect(editor).toContainText("Some bold words");
  await expect(editor).not.toContainText("**");
  // nothing in the note reacts to the pointer
  expect(await editor.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  await page.keyboard.type("typed while reading");
  await expect(editor).not.toContainText("typed while reading");

  await page.keyboard.press("Escape");
  await expect(root).not.toHaveAttribute("data-reading", "true");
  await expect(root).not.toHaveAttribute("data-focus", "true");
  await expect(editor).toHaveAttribute("contenteditable", "true");
});
