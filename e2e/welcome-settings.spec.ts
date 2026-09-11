import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

const ROW =
  /^(Welcome to Rotli|Writing and formatting|Tasks and progress|Choices and toggles|Tables and code|Links and finding|Main and named views|Files and attachments|AI and privacy|Your launch checklist)$/;

test("Settings → Open welcome folder seeds one Welcome folder in Main and opens the welcome note", async ({
  page,
}) => {
  await gotoApp(page);
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Welcome" });
  const rows = page.locator(".main-tree button[data-main-id][data-note-id]", { hasText: ROW });
  await expect(folder).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome folder", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /playground/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Open welcome folder", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(folder).toHaveCount(1);
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toHaveText("Welcome to Rotli");

  // a second run adds nothing and duplicates nothing
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open welcome folder", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await expect(folder).toHaveCount(1);
  await expect(rows).toHaveCount(10);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Location", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open welcome folder" })).toHaveCount(0);
});
