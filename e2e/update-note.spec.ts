// An update you can't miss (the owner, 2026-10-10): the Settings button wears a
// badge while an update waits, and a note drops down from it once per version
// per launch. Update opens Settings; Later closes the note and keeps the badge.
// The twin has no updater, so the spec sets what the routine check would.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

async function announce(page: import("@playwright/test").Page, version: string) {
  await page.evaluate(async (v) => {
    const { useUiStore } = await import("/src/state/ui.ts" as string);
    useUiStore.getState().setUpdateVersion(v);
    useUiStore.getState().setUpdateAvailable(true);
  }, version);
}

test("an available update badges Settings and drops a note; Later keeps the badge", async ({ page }) => {
  await gotoApp(page);
  const settings = page.getByRole("button", { name: /^Update available — open Settings/ });
  await expect(page.locator(".tb-update-badge")).toHaveCount(0);

  await announce(page, "9.9.0");
  await expect(settings).toBeVisible();
  await expect(settings.locator(".tb-update-badge")).toBeVisible();
  const note = page.locator(".update-note");
  await expect(note).toContainText("Update available");
  await expect(note).toContainText("Rotli 9.9.0 is ready to install.");
  // it hangs under the badge, inside the window
  const [badge, box] = await Promise.all([
    settings.locator(".tb-update-badge").boundingBox(),
    note.boundingBox(),
  ]);
  expect(box!.y).toBeGreaterThan(badge!.y + badge!.height);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await note.getByRole("button", { name: "Later" }).click();
  await expect(note).toHaveCount(0);
  await expect(settings.locator(".tb-update-badge")).toBeVisible();
});

test("Update opens Settings on General, where the install is", async ({ page }) => {
  await gotoApp(page);
  await announce(page, "9.9.1");
  await page.locator(".update-note").getByRole("button", { name: "Update…" }).click();
  await expect(page.locator(".update-note")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
});
