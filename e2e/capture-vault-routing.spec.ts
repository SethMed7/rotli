import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Quick Note and Quick capture expose independent destination-vault controls", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const quickNote = page.getByRole("combobox", { name: "Quick Note destination vault" });
  const quickCapture = page.getByRole("combobox", { name: "Quick capture destination vault" });
  await expect(quickNote).toBeVisible();
  await expect(quickCapture).toBeVisible();
  await expect(quickNote).toHaveValue("");
  await expect(quickCapture).toHaveValue("");
  await expect(
    page.getByText("A named vault must have write access in Location", { exact: false }),
  ).toBeVisible();
});
