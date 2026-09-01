import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("holding Command labels tabs with their numbered shortcuts", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  await expect(page.getByRole("tab")).toHaveCount(2);

  await page.keyboard.down("Meta");
  try {
    await expect(page.locator(".hkbadge").filter({ hasText: /^⌘1$/ })).toHaveCount(1);
    await expect(page.locator(".hkbadge").filter({ hasText: /^⌘2$/ })).toHaveCount(1);
  } finally {
    await page.keyboard.up("Meta");
  }
});

test("Command-T's first paint is the focused editor and keeps immediate typing", async ({ page }) => {
  await gotoApp(page);

  await page.keyboard.press("Meta+T");
  // Deliberately do not wait for a note query or an editor locator before this
  // keystroke. The optimistic surface itself must already own keyboard focus.
  await page.keyboard.type("typed on the first paint");

  const editor = page.locator(".pane.focused .cm-content");
  await expect(editor).toContainText("typed on the first paint");
  await expect(editor).toBeFocused();
});

test("held-Command tab badges stay inside a scrolled tab strip", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await gotoApp(page);

  const tabs = page.getByRole("tab");
  for (let count = 2; count <= 8; count += 1) {
    await page.keyboard.press("Meta+T");
    await expect(tabs).toHaveCount(count);
  }

  const strip = page.locator(".tabscroll").first();
  await expect.poll(() => strip.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

  await page.keyboard.down("Meta");
  try {
    // The first tab is fully behind the left edge. Its global fixed badge must
    // not paint over the Home/Breve sidebar where the clipped tab cannot paint.
    await expect(page.locator(".hkbadge").filter({ hasText: /^⌘1$/ })).toHaveCount(0);

    const lastBadge = page.locator(".hkbadge").filter({ hasText: /^⌘8$/ });
    await expect(lastBadge).toHaveCount(1);
    const [stripBox, badgeBox] = await Promise.all([strip.boundingBox(), lastBadge.boundingBox()]);
    expect(stripBox).not.toBeNull();
    expect(badgeBox).not.toBeNull();
    expect(badgeBox!.x).toBeGreaterThanOrEqual(stripBox!.x);
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(stripBox!.x + stripBox!.width);
  } finally {
    await page.keyboard.up("Meta");
  }
});

test("held-Command badges show complete front chords and distinguish the active control", async ({
  page,
}) => {
  await gotoApp(page);

  await page.keyboard.down("Meta");
  try {
    await expect(page.locator(".hkbadge.on-active", { hasText: "⌃⌘1" })).toHaveCount(1);
    await expect(page.locator(".hkbadge:not(.on-active)", { hasText: "⌃⌘2" })).toHaveCount(1);
  } finally {
    await page.keyboard.up("Meta");
  }
});

test("metadata toggle is a registered action", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByRole("button", { name: "Show metadata" })).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Meta+Shift+M");
  await expect(page.getByRole("button", { name: "Hide metadata" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("toggle file metadata");
  await page.locator(".prow", { hasText: "Toggle file metadata" }).click();

  await expect(page.getByRole("button", { name: "Show metadata" })).toHaveAttribute("aria-pressed", "false");
});
