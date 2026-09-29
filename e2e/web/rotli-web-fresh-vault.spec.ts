// A brand-new web vault (2026-09-27, found touring Rotli Web): the Welcome
// lessons are written a moment after the app mounts. The Tasks page read "0"
// and the sidebar's This week card "0 new" until a reload — Tasks cached its
// empty list, and the week count dropped notes newer than its clock's last tick.

import { expect, test } from "@playwright/test";

import { startWithVault } from "./support";

test("a new vault's Tasks page and This week card count the Welcome lessons without a reload", async ({
  page,
}) => {
  await startWithVault(page);

  const week = page.getByRole("button", { name: "Open Rotli activity dashboard" });
  await expect(week).toContainText(/10 new/);

  await page.locator("[role=option]", { hasText: "Tasks" }).first().click();
  const tasks = page.locator(".tasks-surface, [class*=tasks]").first();
  await expect(tasks).not.toContainText("Nothing open");
  await expect(tasks).toContainText("Try a lesson");
});
