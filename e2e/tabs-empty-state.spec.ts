// Seth, 2026-07-28: "I should be able to close all tabs and have an empty
// state which uses one of my quokkas" — the lone pane goes empty instead of
// silently refusing the close, and the rest-state actions lead back in.

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test("closing every tab shows the quokka rest state, and reopen brings the tab back", async ({ page }) => {
  await gotoApp(page);
  const tabs = page.getByRole("tab");
  const openCount = await tabs.count();
  for (let i = 0; i < openCount; i++) {
    await page.locator(".tab .x").first().click();
  }
  await expect(tabs).toHaveCount(0);
  const empty = page.locator(".pane-empty");
  await expect(empty).toBeVisible();
  await expect(empty.locator("svg")).toBeVisible(); // the quokka
  // the inline "reopen tab" action restores the last closed tab
  await empty.getByRole("button", { name: /reopen tab/ }).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.locator(".pane-empty")).toHaveCount(0);
});
