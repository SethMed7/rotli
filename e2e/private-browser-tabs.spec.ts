import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("private-browser tabs create, switch, and close through Rotli's pane strip", async ({ page }) => {
  await gotoApp(page);
  const allTabs = page.getByRole("tab");
  const initialCount = await allTabs.count();

  await page.getByRole("button", { name: "New private browser", exact: true }).click();
  const activeStart = page.locator(".pane-surface-slot.active .browser-start");
  await expect(activeStart).toBeVisible();

  const browserTabs = allTabs.filter({ hasText: "Private browser" });
  await expect(browserTabs).toHaveCount(1);
  const activeDraft = page
    .locator(".pane-surface-slot.active")
    .getByRole("textbox", { name: /^Search with / });
  await activeDraft.fill("first tab research draft");

  const newTab = page.getByRole("button", { name: "New private browser tab — ⌘T", exact: true });
  await newTab.click();
  await page.keyboard.press("Meta+t");
  await newTab.click();

  await expect(allTabs).toHaveCount(initialCount + 4);
  await expect(browserTabs).toHaveCount(4);
  await expect(browserTabs.nth(3)).toHaveAttribute("aria-selected", "true");
  await expect(activeStart).toBeVisible();

  await browserTabs.nth(0).click();
  await expect(browserTabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(activeStart).toBeVisible();
  await expect(activeDraft).toHaveValue("first tab research draft");

  await browserTabs.nth(0).locator(".x").click();
  await expect(browserTabs).toHaveCount(3);
  await expect(activeStart).toBeVisible();
});
