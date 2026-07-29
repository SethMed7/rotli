// The ⌘N chooser tab (Seth, 2026-07-29): a blank new tab with no type — you
// choose Markdown / Document / Sheet / Board / Mermaid. Driven through the
// palette action (real controls; CI has no Meta key for the chord).

import { expect, test } from "@playwright/test";
import { gotoApp } from "./support";

test("the chooser tab offers every kind and becomes what you pick", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();

  const chooser = page.locator(".ni-surface");
  await expect(chooser).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toContainText("New…");
  await expect(chooser.getByRole("button", { name: "New Mermaid diagram" })).toBeVisible();
  await expect(chooser.getByRole("button", { name: "New Board" })).toBeVisible();

  // picking Markdown replaces the chooser with a real note tab
  await chooser.getByRole("button", { name: "New Markdown note" }).click();
  await expect(page.locator(".ni-surface")).toHaveCount(0);
  await expect(page.locator(".cm-content").last()).toBeVisible();
});

test("a Mermaid diagram item is born with the starter fence", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("New Mermaid");
  await page.locator(".prow", { hasText: "New Mermaid diagram" }).click();
  // the note opens with the rendered starter diagram in place
  await expect(page.locator(".rotli-render-mermaid-trigger")).toBeVisible();
});
