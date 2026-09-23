// Rotli Web has no app hotkeys (featurePolicy `hotkeys`): the browser's own
// shortcuts own ⌃Tab, ⌘[, ⌘←, ⌘W… (2026-09-23: in Zen they changed tabs and
// views under the owner). The editor's text formatting keeps its keys, and no
// hint names a key that does nothing.

import { expect, test } from "@playwright/test";
import { type Page } from "@playwright/test";

import { startWithVault } from "./support";

test("app chords do nothing on the web, and there is no Keybindings pane or ⌘K hint", async ({ page }) => {
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

  // (⌘B still formatting on the web is pinned by src/keys/chordInBuild.test.ts:
  // the Linux runner has no ⌘ key to press)

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

/** Every chord the screen names outside note text and the format bar (whose
 * ⌘B/⌘I still work): visible text, hover tips, aria-labels, titles. */
function chordsOnScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const skip = (el: Element) => el.closest(".cm-content, .fmtbar") !== null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (el && !skip(el) && /[⌘⌃]/.test(node.textContent ?? ""))
        found.push(`text: ${node.textContent?.trim()}`);
    }
    for (const el of document.querySelectorAll("[aria-label], [title]")) {
      if (skip(el)) continue;
      for (const attr of ["aria-label", "title"]) {
        const value = el.getAttribute(attr) ?? "";
        if (/[⌘⌃]/.test(value)) found.push(`${attr}: ${value}`);
      }
    }
    return found;
  });
}

test("Rotli Web names no app chord anywhere it can be seen", async ({ page }) => {
  await startWithVault(page);
  await expect(page.locator(".cm-content").first()).toBeVisible();
  expect(await chordsOnScreen(page)).toEqual([]);
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  // every pane the web offers (review of #66: the first pass only opened General)
  const panes = page.locator("nav.set-nav button:not(.set-back)");
  await expect(panes.first()).toBeVisible();
  const labels = (await panes.allInnerTexts()).map((label) => label.trim());
  expect(labels.length).toBeGreaterThan(3);
  for (const label of labels) {
    await panes.filter({ hasText: label }).first().click();
    await page.waitForTimeout(150);
    expect(await chordsOnScreen(page), `Settings → ${label}`).toEqual([]);
  }
  // and the Mac-only panes aren't offered at all
  expect(labels).not.toContain("Keybindings");
  expect(labels).not.toContain("Browser");
});
