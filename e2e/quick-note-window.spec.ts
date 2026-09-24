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

// ⌘⇧L reaching the open note is unit-tested (quickNoteActions.test.ts): the
// browser twin has no Secure lane to flip.
test("in the Quick Note, ⌘1–⌘9 and ⌘⇧1–⌘⇧9 open picker rows", async ({ page }) => {
  await page.goto("/?window=quick");
  const win = page.locator(".quick-window");
  await win.getByRole("button", { name: "New note" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("Keys from the Quick Note");

  // the picker: held ⌘ badges rows with their chords; ⌘2 opens row 2
  const title = win.locator(".quick-pick-name");
  const picker = page.getByRole("dialog", { name: "Switch or pin a note" });
  const rows = picker.locator(".qsopen .qslabel");
  await page.keyboard.press("Meta+P");
  await expect(rows.nth(9)).toBeVisible();
  await page.keyboard.down("Meta");
  await expect(page.locator(".hkbadge", { hasText: "⌘2" })).toBeVisible();
  await page.keyboard.up("Meta");
  const second = (await rows.nth(1).textContent()) ?? "";
  await page.keyboard.press("Meta+2");
  await expect(picker).toHaveCount(0);
  await expect(title).toHaveText(second);

  // ⌘⇧1 opens row 10
  await page.keyboard.press("Meta+P");
  await expect(rows.nth(9)).toBeVisible();
  const tenth = (await rows.nth(9).textContent()) ?? "";
  await page.keyboard.press("Meta+Shift+1");
  await expect(picker).toHaveCount(0);
  await expect(title).toHaveText(tenth);

  // with the picker closed the number chords do nothing
  await page.keyboard.press("Meta+3");
  await expect(title).toHaveText(tenth);
});
