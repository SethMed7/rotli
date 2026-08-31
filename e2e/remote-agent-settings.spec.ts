import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Remote agents stay native-only and explicit in the browser twin", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 620 });
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Remote agents" })).toBeVisible();
  await expect(page.getByText("Pairing is available only in the native Mac app.")).toBeVisible();
  await expect(page.getByLabel("Relay MCP URL")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create pairing" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect this session" })).toBeDisabled();

  const surface = page.locator(".remote-agents");
  expect(await surface.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});
