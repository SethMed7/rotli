import { expect, test } from "@playwright/test";

import { auditAccessibility, auditSettings, auditThemes, auditWorkspace } from "../accessibility";
import { startWithVault } from "./support";

test("web primary workspace surfaces have no serious or critical axe violations", async ({ page }, info) => {
  test.slow();
  await startWithVault(page);
  await auditWorkspace(page, info);
});

test("web settings panes have no serious or critical axe violations", async ({ page }, info) => {
  test.slow();
  await startWithVault(page);
  await auditSettings(page, info, "web");
});

test("web note shell is accessible in all fourteen environments", async ({ page }, info) => {
  test.slow();
  await startWithVault(page);
  await auditThemes(page, info);
});

test("web Excalidraw creation dialog and board have no serious or critical axe violations", async ({
  page,
}, info) => {
  test.slow();
  await startWithVault(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await page
    .locator(".ni-surface")
    .getByRole("button", { name: /^New Board/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Name Excalidraw board" });
  await dialog.getByRole("textbox", { name: "Board name" }).fill("Accessibility sketch");
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Create board" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("textbox", { name: "Board name" })).toBeFocused();
  await auditAccessibility(page, info, "board-name-dialog");
  await dialog.getByRole("button", { name: "Create board" }).click();
  await expect(page.locator(".canvas-surface canvas.interactive")).toBeVisible();
  await auditAccessibility(page, info, "excalidraw-board");
});
