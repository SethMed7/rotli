// Rotli Web has no app hotkeys (featurePolicy `hotkeys`): the browser's own
// shortcuts own ⌃Tab, ⌘[, ⌘←, ⌘W… (2026-09-23: in Zen they changed tabs and
// views under the owner). The editor's text formatting keeps its keys, and no
// hint names a key that does nothing.

import { expect, test } from "@playwright/test";

import { readOpfsFile, startWithVault } from "./support";

test("app chords do nothing on the web; ⌘B still bolds; no Keybindings pane or ⌘K hint", async ({ page }) => {
  await startWithVault(page);
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.type("# Second\n\nword");
  const selected = page.getByRole("tab", { selected: true });
  await expect(selected).toContainText("Second");
  const tabCount = await page.getByRole("tab").count();

  // the app's tab, history, pane, and view chords stay the browser's
  for (const chord of [
    "Control+Tab",
    "Control+Shift+Tab",
    "Meta+BracketLeft",
    "Meta+ArrowLeft",
    "Meta+1",
    "Meta+Shift+S",
    "Meta+t",
  ]) {
    await page.keyboard.press(chord);
    await page.waitForTimeout(150);
    await expect(selected).toContainText("Second");
  }
  await expect(page.getByRole("tab")).toHaveCount(tabCount);

  // text formatting still answers
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("ControlOrMeta+b");
  await expect
    .poll(
      async () => {
        const files = await page.evaluate(async () => {
          const out: string[] = [];
          const dir = await (
            await navigator.storage.getDirectory()
          )
            .getDirectoryHandle("wiki")
            .then((w) => w.getDirectoryHandle("_inbox"))
            .catch(() => null);
          if (!dir) return out;
          for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>)
            out.push(name);
          return out;
        });
        const texts = await Promise.all(files.map((f) => readOpfsFile(page, `wiki/_inbox/${f}`)));
        return texts.some((t) => t.includes("**word**"));
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // no hint for a key that does nothing
  await expect(page.locator(".tb-search-kbd")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Search notes and actions/ })).not.toHaveAccessibleName(/⌘K/);
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "General" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Keybindings" })).toHaveCount(0);
});
