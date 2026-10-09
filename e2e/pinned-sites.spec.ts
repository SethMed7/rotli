// Pinned sites (2026-10-01, docs/decisions/2026-10-01-pinned-sites.md): a site
// pinned in Settings → Browser gets a button left of the globe that opens it
// in a panel, not a tab. This build has no native pages, so the panel says the
// page is the Mac app's; the signed-in page itself is a native check.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("a pinned site: added in Settings, opened from the title bar in a panel, removed", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  const address = page.getByRole("textbox", { name: "Site address" });
  await address.fill("http://x.com");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("That isn’t an https address.");
  await address.fill("x.com");
  await page.getByRole("textbox", { name: "Site name" }).fill("My X");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("list", { name: "Pinned sites" }).getByRole("listitem")).toHaveText(["My X×"]);
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();

  // left of the globe, and it opens a panel — no new tab
  const tabs = await page.getByRole("tab").count();
  const pin = page.locator(".titlebar").getByRole("button", { name: "Open My X" });
  const globe = page.locator(".titlebar").getByRole("button", { name: "New private browser" });
  const [pinBox, globeBox] = await Promise.all([pin.boundingBox(), globe.boundingBox()]);
  expect(pinBox && globeBox && pinBox.x < globeBox.x).toBe(true);
  await pin.click();
  const panel = page.getByRole("region", { name: "My X" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("x.com");
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  expect(await page.getByRole("tab").count()).toBe(tabs);
  // ⌘K-style overlays close it first (a native page would draw over them)
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Escape");
  await pin.click();
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Close My X" }).click();
  await expect(panel).toHaveCount(0);

  // removing it takes the button away (and signs it out, in the Mac app)
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Browser", exact: true }).click();
  await page.getByRole("button", { name: "Remove “My X”" }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(pin).toHaveCount(0);
});
