import { writeFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

import { SOLID_THEMES } from "../src/state/themeChoices";

/** Whole-document scans: never hide a component or disable a rule to get green.
 * Retain all results; the required gate covers moderate, serious and critical findings. */
export async function auditAccessibility(page: Page, info: TestInfo, surface: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const results = await new AxeBuilder({ page }).analyze();
  const path = info.outputPath(`axe-${surface}.json`);
  await writeFile(path, JSON.stringify(results, null, 2));
  await info.attach(`axe-${surface}`, { path, contentType: "application/json" });
  const actionable = results.violations.filter(
    (v) => v.impact === "moderate" || v.impact === "serious" || v.impact === "critical",
  );
  expect
    .soft(
      actionable.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      })),
      `axe moderate/serious/critical violations on ${surface}`,
    )
    .toEqual([]);
}

export async function auditSettings(page: Page, info: TestInfo, platform: "web" | "desktop"): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  const navigation = page.getByRole("navigation", { name: "Settings sections" });
  const panes = [
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
  if (platform === "desktop") panes.push("Keybindings", "Browser");
  for (const pane of panes) {
    await navigation.getByRole("button", { name: pane, exact: true }).click();
    await expect(navigation.getByRole("button", { name: pane, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await auditAccessibility(page, info, `settings-${pane.toLowerCase().replaceAll(" ", "-")}`);
  }
}

export async function auditWorkspace(page: Page, info: TestInfo): Promise<void> {
  await expect(page.locator(".cm-content").first()).toBeVisible();
  await auditAccessibility(page, info, "main-and-note");
  for (const label of ["All notes", "Captures", "Tasks", "Library", "Assets", "Archive", "Trash"]) {
    await page.locator(".sb-notes-tree button, .sb-system button", { hasText: label }).first().click();
    await auditAccessibility(page, info, label.toLowerCase().replaceAll(" ", "-"));
  }
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  const search = page.getByPlaceholder("Search notes, files, chats, actions…");
  await search.fill("note");
  await expect(page.locator(".prow").first()).toBeVisible();
  await auditAccessibility(page, info, "search");
  await search.fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await expect(page.locator(".ni-surface")).toBeVisible();
  await auditAccessibility(page, info, "new-item-chooser");
  await page
    .locator(".ni-surface")
    .getByRole("button", { name: /^New Chat/ })
    .click();
  await expect(page.locator("[data-chat-pane], .web-chat-setup").first()).toBeVisible();
  await auditAccessibility(page, info, "chat-or-setup");
}

/** Theme switching uses the same Settings and titlebar controls as a person. */
export async function auditThemes(page: Page, info: TestInfo): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "All 14", exact: true }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  const themeButton = page.getByRole("button", { name: /^Theme —/ });
  for (const { label } of SOLID_THEMES) {
    await expect(themeButton).toHaveAccessibleName(new RegExp(`^Theme — ${label} · `));
    await auditAccessibility(page, info, `theme-${label.toLowerCase().replaceAll(" ", "-")}`);
    await themeButton.click();
  }
}
