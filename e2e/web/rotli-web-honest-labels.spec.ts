// Rotli Web says what the web can do (2026-09-27, found touring Rotli Web): a
// note's header named its place "On this Mac", and the new-tab chooser offered
// the private Browser, a native window that on the web could only fail.

import { expect, test } from "@playwright/test";

import { plantOpfsFiles, readOpfsFile, startWithVault } from "./support";

test("web Welcome files teach clickable controls and supported creation", async ({ page }) => {
  await startWithVault(page);
  const welcome = await readOpfsFile(page, "wiki/Welcome/Welcome to Rotli.md");
  const organizing = await readOpfsFile(page, "wiki/Welcome/02 Organizing and finding.md");
  expect(welcome).toContain("tab strip’s **+**");
  expect(welcome).toContain("search field");
  expect(welcome).not.toMatch(/[⌘⌥]/);
  expect(organizing).toContain("New → Board");
  expect(organizing).not.toContain("Document");
});

test("a web note is in your folder, and the Browser card says it is in the Mac app", async ({ page }) => {
  await startWithVault(page);
  const header = page.locator(".status-inline").first();
  await expect(header).toContainText("In your folder");
  await expect(header).not.toContainText("On this Mac");

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  const browser = page.locator(".ni-surface").getByRole("button", { name: /^New Browser/ });
  await expect(browser).toHaveAttribute("aria-disabled", "true");
  await expect(browser).toContainText("In the Mac app");
  // the Board card still works on the web
  await expect(page.locator(".ni-surface").getByRole("button", { name: /^New Board \(press/ })).toBeVisible();
});

test("web note menus hide Finder-only actions and General names browser settings", async ({ page }) => {
  await startWithVault(page);
  await page.locator(".ed-head").first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Show in Finder" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Copy File Path" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  await page.getByRole("button", { name: "General" }).first().click();
  await expect(page.getByText(/It lives in this browser’s settings/)).toBeVisible();
});

test("web Empty Trash confirms permanent deletion", async ({ page }) => {
  await startWithVault(page);
  await plantOpfsFiles(page, { "trash/wiki/deleted.md": "# Deleted\n\nAn old note.\n" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator(".sb-system .frow", { hasText: "Trash" }).click();
  await page.getByRole("button", { name: "Empty Trash…" }).click();
  await expect(page.getByRole("button", { name: "Delete 1 item permanently" })).toBeVisible();
  await expect(page.getByText(/recoverable in the macOS Trash/)).toHaveCount(0);
});

test("the web palette and note header fit a narrow window without partial words", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 700 });
  await startWithVault(page);
  await expect(page.locator(".ed-head").first()).toBeVisible();
  expect(
    await page
      .locator(".ed-head")
      .first()
      .evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe("normal");
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  const footer = page.locator(".pal-foot");
  await expect(footer).toBeVisible();
  const layout = await footer.evaluate((el) => {
    const visible = [...el.children].filter((child) => getComputedStyle(child).display !== "none");
    return {
      rows: new Set(visible.map((child) => child.getBoundingClientRect().top)).size,
      overflow: el.scrollWidth > el.clientWidth,
    };
  });
  expect(layout).toEqual({ rows: 1, overflow: false });
});
