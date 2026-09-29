// Rotli Web says what the web can do (2026-09-27, found touring Rotli Web): a
// note's header named its place "On this Mac", and the new-tab chooser offered
// the private Browser, a native window that on the web could only fail.

import { expect, test } from "@playwright/test";

import { startWithVault } from "./support";

test("a web note is in your folder, and the Browser card says it is in the Mac app", async ({ page }) => {
  await startWithVault(page);
  const header = page.locator(".status-inline").first();
  await expect(header).toContainText("In your folder");
  await expect(header).not.toContainText("On this Mac");

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  const browser = page.locator(".ni-surface").getByRole("button", { name: /^New Browser/ });
  await expect(browser).toHaveAttribute("aria-disabled", "true");
  await expect(browser).toContainText("In the Mac app");
  // the Board card still works on the web
  await expect(page.locator(".ni-surface").getByRole("button", { name: /^New Board \(press/ })).toBeVisible();
});
