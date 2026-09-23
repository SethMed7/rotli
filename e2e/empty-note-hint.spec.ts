// An empty note's "Write…" hint is painted behind a plain empty line, never a
// widget in it, so the native caret keeps real line metrics in every engine
// (2026-09-23: in Zen the caret sat above the hint). Typing hides it; clearing
// the note brings it back.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("an empty note shows the hint behind a plain empty line, and typing hides it", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  const editor = page.locator(".cm-content").last();
  await expect(editor).toHaveAttribute("aria-placeholder", "Write…");
  const line = editor.locator(".cm-line").first();
  await expect(line).toHaveClass(/rotli-empty-hint/);
  // no widget in the line: only CodeMirror's <br> for an empty line
  await expect(line.locator(".cm-placeholder, .cm-widgetBuffer")).toHaveCount(0);
  const hint = () => line.evaluate((el) => getComputedStyle(el, "::before").content);
  expect(await hint()).toBe('"Write…"');

  await editor.click();
  await page.keyboard.type("Hello");
  await expect(line).not.toHaveClass(/rotli-empty-hint/);
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Backspace");
  await expect(editor.locator(".cm-line").first()).toHaveClass(/rotli-empty-hint/);
});
