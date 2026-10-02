// A walk through every major surface of Rotli Web (2026-09-27): the sidebar
// rows, the System browsers, the dashboard, Chat's setup, every Settings pane,
// the palette, the new-tab chooser, the vault switcher, a narrow window, and a
// dark theme. The page must stay quiet: no console error or warning, no page
// error, and no failed request anywhere on the way.

import { expect, test, type Page } from "@playwright/test";

import { themeNow } from "../support";
import { startWithVault } from "./support";

test.use({ viewport: { width: 1280, height: 820 } });

// the web build's panes (Keybindings and Browser are Mac-only by design)
const SETTINGS_PANES = [
  "General",
  "Appearance",
  "Librarian",
  "Security",
  "AI Models",
  "Chat",
  "Location",
  "Connections",
  "About Rotli",
];

function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text().slice(0, 240)}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message.slice(0, 240)}`));
  page.on("response", (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`);
  });
  return problems;
}

test("every major web surface opens without a console error or a failed request", async ({ page }) => {
  test.slow();
  const problems = watchProblems(page);
  await startWithVault(page);
  const row = (label: string) => page.locator("[role=option]", { hasText: label }).first();

  for (const label of ["All notes", "Captures", "Tasks", "Library", "Assets", "Archive", "Trash"]) {
    await row(label).click();
  }
  await page.getByRole("button", { name: "Open Rotli activity dashboard" }).click();
  await expect(page.getByText("Your vault in Rotli")).toBeVisible();

  await page.locator(".sb-switch-seg", { hasText: /^Chat/ }).click();
  await expect(page.getByRole("dialog", { name: "Chat on the web" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  for (const pane of SETTINGS_PANES) {
    await nav.getByRole("button", { name: pane, exact: true }).click();
    await expect(nav.getByRole("button", { name: pane, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await nav.getByRole("button", { name: "Back to notes" }).click();

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Vault: / }).click();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 640, height: 820 });
  await row("All notes").click();
  await page.setViewportSize({ width: 1280, height: 820 });
  for (let step = 0; step < 14; step += 1) {
    const toggle = page.getByRole("button", { name: /^Theme — / });
    if (/Dark/.test(themeNow(await toggle.getAttribute("aria-label")))) break;
    await toggle.click();
  }
  await row("Welcome to Rotli").click();
  await expect(page.locator(".cm-content").first()).toBeVisible();

  expect(problems).toEqual([]);
});
