// the maintainer, 2026-07-28: "I should be able to close all tabs and have an empty
// state which uses one of my quokkas" — the lone pane goes empty instead of
// silently refusing the close, and the rest-state actions lead back in. Since
// the appearance studio landed, the quokka companion is opt-in
// (quokkaCompanionEnabled defaults to false), so a fresh profile shows the
// rest state without character art.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Command-W closes the active tab without hiding the workspace", async ({ page }) => {
  await gotoApp(page);
  const tabs = page.getByRole("tab");
  const initial = await tabs.count();
  await page.keyboard.press("Meta+T");
  await expect(tabs).toHaveCount(initial + 1);

  await page.keyboard.press("Meta+W");
  await expect(tabs).toHaveCount(initial);
  await expect(page.getByRole("main")).toBeVisible();
});

test("closing every tab shows the rest state, and reopen brings the tab back", async ({ page }) => {
  await gotoApp(page);
  const tabs = page.getByRole("tab");
  const openCount = await tabs.count();
  for (let i = 0; i < openCount; i++) {
    await page.locator(".tab .x").first().click();
  }
  await expect(tabs).toHaveCount(0);
  const empty = page.locator(".pane-empty");
  await expect(empty).toBeVisible();
  await expect(empty.getByText("All clear")).toBeVisible();
  // companion off by default — the character renders only when opted in
  await expect(empty.locator(".quokka")).toHaveCount(0);
  // the inline "reopen tab" action restores the last closed tab
  await empty.getByRole("button", { name: /reopen tab/ }).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.locator(".pane-empty")).toHaveCount(0);
});
