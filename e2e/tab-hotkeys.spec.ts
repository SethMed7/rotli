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
