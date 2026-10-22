import { expect, test } from "@playwright/test";

import { auditAccessibility, auditSettings, auditThemes, auditWorkspace } from "./accessibility";
import { gotoApp } from "./support";

test("desktop primary workspace surfaces have no serious or critical axe violations", async ({
  page,
}, info) => {
  test.slow();
  await gotoApp(page);
  await auditWorkspace(page, info);
});

test("desktop settings panes have no serious or critical axe violations", async ({ page }, info) => {
  test.slow();
  await gotoApp(page);
  await auditSettings(page, info, "desktop");
});

test("development Graph and canvas refusal have no serious or critical axe violations", async ({
  page,
}, info) => {
  test.slow();
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  const search = page.getByPlaceholder("Search notes, files, chats, actions…");
  await search.fill("Graph");
  await page.locator(".prow", { hasText: "Graph of all notes" }).first().click();
  await expect(page.getByRole("application", { name: /Graph of/ })).toBeVisible();
  await auditAccessibility(page, info, "graph");
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await search.fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await page
    .locator(".ni-surface")
    .getByRole("button", { name: /^New Canvas/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Name canvas", exact: true });
  await dialog.getByRole("textbox", { name: "Canvas name" }).fill("Synthetic layout");
  await dialog.getByRole("button", { name: "Create canvas", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Canvases need a vault folder");
  await auditAccessibility(page, info, "canvas-creation-refusal");
});

test("desktop note shell is accessible in all fourteen environments", async ({ page }, info) => {
  test.slow();
  await gotoApp(page);
  await auditThemes(page, info);
});

test("tab controls support arrows, Home and End without swallowing close actions", async ({ page }) => {
  await gotoApp(page);
  const tabs = page.getByRole("tab");
  await page.locator(".tabplus").click();
  await expect(tabs).toHaveCount(2);
  await tabs.first().focus();
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await expect(tabs.last()).toHaveAttribute("tabindex", "0");
  await expect(tabs.first()).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await page.locator(".tab.active").getByRole("button", { name: "Close tab" }).click();
  await expect(tabs).toHaveCount(1);
});
