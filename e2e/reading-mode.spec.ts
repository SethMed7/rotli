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

// The chrome leaves, so the page gets room above it instead of starting flush
// at the window's top edge (the owner, 2026-10-16) — reading mode only, and a
// short narrow window keeps most of its height for the note.
const paddingTop = (node: Element) => parseFloat(getComputedStyle(node).paddingTop);

for (const size of [
  { width: 1280, height: 800, min: 60 },
  { width: 520, height: 420, min: 28 },
]) {
  test(`reading mode gives the note room above it at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await gotoApp(page);
    await page.getByRole("button", { name: /^New note in / }).click();
    const editor = page.locator(".cm-content").last();
    await editor.click();
    await page.keyboard.type("Read me");
    const writing = await editor.evaluate(paddingTop);

    await page.getByRole("button", { name: /Search notes and actions/ }).click();
    await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Reading mode");
    await page.locator(".prow", { hasText: "Reading mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-reading", "true");

    const reading = await editor.evaluate(paddingTop);
    expect(reading).toBeGreaterThanOrEqual(size.min);
    expect(reading).toBeLessThanOrEqual(size.height * 0.12);
    expect(reading).toBeGreaterThan(writing);
    const top = await editor.evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);

    await page.keyboard.press("Escape");
    await expect(page.locator("html")).not.toHaveAttribute("data-reading", "true");
    expect(await editor.evaluate(paddingTop)).toBe(writing);
  });
}
