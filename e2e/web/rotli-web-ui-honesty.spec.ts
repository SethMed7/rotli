import { expect, test } from "@playwright/test";

import { plantOpfsFiles, startWithVault } from "./support";

test("search never offers native window or vault-refresh actions", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  const search = page.getByRole("combobox", { name: "Search notes and actions" });
  for (const name of [
    "Quick capture",
    "Quick note",
    "Open or hide Rotli",
    "Refresh current vault",
    "Hide Rotli",
    "Open web browser",
    "Open a private browser",
    "Jump into the sidebar",
  ]) {
    await search.fill(name);
    await expect(page.getByRole("option", { name: new RegExp(name, "i") })).toHaveCount(0);
  }
});

test("note chat actions open the web setup guide when no helper is connected", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  const search = page.getByRole("combobox", { name: "Search notes and actions" });
  for (const title of ["Chat with this note", "New chat about this note"]) {
    await search.fill(title);
    await page.getByRole("option", { name: new RegExp(title) }).click();
    await expect(page.getByRole("dialog", { name: "Chat on the web" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "invoke" })).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "Chat on the web" })
      .getByRole("button", { name: /Close/ })
      .click();
    await page
      .getByRole("button", { name: /Search notes and actions/ })
      .first()
      .click();
  }
  await page.keyboard.press("Escape");
  for (const title of ["Chat with this note", "New chat about this note"]) {
    await page.locator(".ed-head").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: title }).click();
    await expect(page.getByRole("dialog", { name: "Chat on the web" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "invoke" })).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "Chat on the web" })
      .getByRole("button", { name: /Close/ })
      .click();
  }
});

test("the palette never suggests a note in an unnamed system target", async ({ page }) => {
  await startWithVault(page);
  await page.locator(".sb-system .frow", { hasText: "Library" }).click();
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  await expect(page.getByRole("option", { name: "New note in “”" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "New note", exact: true })).toBeVisible();
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

test("a folder vault refreshes its listing when the page regains focus", async ({ page }) => {
  await startWithVault(page);
  await plantOpfsFiles(page, { "wiki/focus-added.md": "# Focus added\n\nFrom another app.\n" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  await page.getByRole("combobox").fill("Focus added");
  await expect(page.getByRole("option", { name: /Focus added/ })).toBeVisible();
});
