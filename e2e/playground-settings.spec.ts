import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the editable playground is discoverable in General settings", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Playground", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import playground" })).toBeVisible();

  await page.getByRole("button", { name: "Location", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import playground" })).toHaveCount(0);
});
