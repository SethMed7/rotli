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
  await expect(chooser.getByRole("button", { name: "New Chat" })).toBeVisible();
  await expect(chooser.getByRole("button", { name: "New Mermaid diagram" })).toBeVisible();
  await expect(chooser.getByRole("button", { name: "New Board" })).toBeVisible();
  // every card wears its digit (Chat is 1 — "cmd+n then 1 for chat")
  await expect(chooser.getByRole("button", { name: "New Chat" }).locator(".ni-key")).toHaveText("1");

  // picking Markdown replaces the chooser with a real note tab
  await chooser.getByRole("button", { name: "New Markdown note" }).click();
  await expect(page.locator(".ni-surface")).toHaveCount(0);
  await expect(page.locator(".cm-content").last()).toBeVisible();
});

test("the chooser answers a bare digit press — no click needed", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();

  // the surface takes focus on open, so the digit lands without a click;
  // 2 = Markdown note (1 is Chat)
  await expect(page.locator(".ni-surface")).toBeVisible();
  await page.keyboard.press("2");
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
