// The pane-focus landing light (the maintainer, 2026-07-30): when focus moves between
// panes in a split, the arriving pane briefly wears an accent outline
// (.focus-flash) and it fades away — a quick "you are here", not a permanent
// decoration.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test.use({ viewport: { width: 1600, height: 900 } });

/** Record every pane that ever wears the landing light — the flash is short,
 * and a loaded CI worker can miss it between two polls (it did, 2026-09-03). */
async function watchFlashes(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const seen: Element[] = [];
    (window as Window & { __flashed?: Element[] }).__flashed = seen;
    const note = (el: Element) => {
      if (el.classList.contains("focus-flash") && !seen.includes(el)) seen.push(el);
    };
    document.querySelectorAll(".pane").forEach(note);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) note(record.target);
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            note(node);
            node.querySelectorAll(".pane").forEach(note);
          }
        });
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
}

const flashedCount = (page: import("@playwright/test").Page) =>
  page.evaluate(() => ((window as Window & { __flashed?: Element[] }).__flashed ?? []).length);

test("focusing another pane flashes it briefly, then the light fades", async ({ page }) => {
  await gotoApp(page);
  await watchFlashes(page);

  // carve a second pane through a real control: the note row's Open to the right
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  await page.locator(".recent-row", { hasText: "Launch checklist" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open to the right" }).click();
  await expect(page.locator(".pane")).toHaveCount(2);

  // the newly carved pane arrived focused → it wore the landing light …
  await expect.poll(() => flashedCount(page)).toBe(1);
  // … and the light fades on its own
  await expect(page.locator(".pane.focus-flash")).toHaveCount(0, { timeout: 2_000 });

  // clicking back into the first pane flashes THAT pane
  const first = page.locator(".pane").first();
  await first.locator(".pane-body").click();
  await expect.poll(() => flashedCount(page)).toBe(2);
  expect(
    await page.evaluate(() => {
      const flashed = (window as Window & { __flashed?: Element[] }).__flashed ?? [];
      return flashed[1] === document.querySelector(".pane");
    }),
  ).toBe(true);
  await expect(page.locator(".pane.focus-flash")).toHaveCount(0, { timeout: 2_000 });
});
