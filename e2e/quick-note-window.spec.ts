// The Quick Note window, driven as `?window=quick` in the browser twin
// (2026-09-23). What this CAN prove: a blank note is a "New note", never an
// "Untitled" row in the picker, and holding ⌘ pins the window's own shortcuts
// to its buttons. What it cannot: the native panel's summon, activation, and
// the main window staying put behind it — the owner's native checklist.

import { expect, test } from "@playwright/test";

test("a blank quick note is a New note, never an Untitled row, and ⌘ shows its keys", async ({ page }) => {
  await page.goto("/?window=quick");
  const win = page.locator(".quick-window");
  await expect(win).toBeVisible();

  await win.getByRole("button", { name: "New note" }).click();
  const title = win.locator(".quick-pick-name");
  await expect(title).toHaveText("New note");

  // the blank note is open, not listed; ⌘N keeps it rather than stacking another
  await win.getByRole("button", { name: "Switch or pin a note — ⌘P" }).click();
  const picker = page.getByRole("dialog", { name: "Switch or pin a note" });
  await expect(picker.locator(".qsrow").first()).toBeVisible();
  await expect(picker.getByText("Untitled", { exact: true })).toHaveCount(0);
  await expect(picker.locator(".qstag")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  // writing makes it a real note: named by its first line, listed and open
  await page.locator(".cm-content").click();
  await page.keyboard.type("Groceries for Friday");
  await expect(title).toHaveText("Groceries for Friday");
  await win.getByRole("button", { name: "Switch or pin a note — ⌘P" }).click();
  await expect(picker.locator(".qsrow", { hasText: "Groceries for Friday" }).locator(".qstag")).toHaveText(
    "open",
  );
  await page.keyboard.press("Escape");

  // hold ⌘: the window's own shortcuts sit on its buttons; release clears them
  await page.keyboard.down("Meta");
  await expect(page.locator(".hkbadge", { hasText: "⌘N" })).toBeVisible();
  await expect(page.locator(".hkbadge", { hasText: "⌘P" })).toBeVisible();
  await page.keyboard.up("Meta");
  await expect(page.locator(".hkbadge")).toHaveCount(0);
});
