import { expect, test } from "@playwright/test";

import { plantOpfsFiles, startWithVault } from "./support";

test("search never offers native window or vault-refresh actions", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  const search = page.getByRole("combobox", { name: "Search notes and actions" });
  for (const name of ["Quick capture", "Quick note", "Open or hide Rotli", "Refresh current vault"]) {
    await search.fill(name);
    await expect(page.getByRole("option", { name: new RegExp(name, "i") })).toHaveCount(0);
  }
});

test("Settings explains desktop runtime limits and keeps connected CLI configuration", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Librarian", exact: true }).click();
  await expect(page.getByText("The Librarian is available in Rotli for Mac.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Pass queued/)).toHaveCount(0);
  await page.getByRole("button", { name: "AI Models", exact: true }).click();
  await expect(page.getByText("Local models are available in Rotli for Mac.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Scan my Mac|Install|Uninstall|Make default)$/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Connected models" })).toBeVisible();
});

test("web hides document slash creation and explains existing document and sheet fences", async ({
  page,
}) => {
  await startWithVault(page);
  await plantOpfsFiles(page, {
    "wiki/embed-limits.md":
      "# Embed limits\n\n```document\nstorage/example.docx\n```\n\n```sheet\nstorage/example.xlsx\n```\n\n```sheet\nstorage/example.csv\n```\n\nEnd.",
  });
  await page.reload();
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  await page.getByRole("combobox").fill("Embed limits");
  await expect(page.getByRole("option").first()).toContainText("Embed limits");
  await page.getByRole("option").first().click();
  await expect(page.getByText("This document opens in Rotli for Mac.", { exact: true })).toBeVisible();
  await expect(page.getByText("This spreadsheet opens in Rotli for Mac.", { exact: true })).toBeVisible();
  await expect(page.getByText("This CSV embed opens in Rotli for Mac.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.type("/document");
  await expect(page.getByRole("menuitem", { name: /Document/ })).toHaveCount(0);
});
