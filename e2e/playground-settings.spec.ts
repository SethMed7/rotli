import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the editable playground is discoverable in General settings", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Playground", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import playground" })).toBeVisible();
  // Browser mode cannot write a native vault. It must report that failure and
  // make retry available, never claim it imported files it cannot create.
  await page.getByRole("button", { name: "Import playground" }).click();
  await expect(page.getByRole("alert")).toContainText("the corpus only exists inside the Tauri shell");
  await expect(page.getByRole("button", { name: "Import playground" })).toBeEnabled();

  await page.getByRole("button", { name: "Location", exact: true }).click();
  await expect(page.getByRole("button", { name: "Import playground" })).toHaveCount(0);
});
