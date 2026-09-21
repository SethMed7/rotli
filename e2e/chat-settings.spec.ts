// Settings → Chat (the owner, 2026-09-21): one home for how chats start — the
// model a new chat opens on, and how a chat gets its name. The browser twin has
// no model lanes, so what it proves is the pane's shape and that its knobs are
// the live ones; testing a real model is the owner's native check.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Settings has a Chat pane holding the new-chat model and both naming choices", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "Chat", exact: true })).toBeVisible();

  const model = page.getByRole("combobox", { name: "Default model for new chats" });
  await expect(model).toBeVisible();
  await expect(model.locator("option").first()).toHaveText("Rotli picks (this Mac's default)");

  // naming lives here now — and only here
  const naming = page.getByRole("button", { name: "First message", exact: true });
  await naming.click();
  await expect(naming).toHaveAttribute("aria-pressed", "true");
  const byMeaning = page.getByRole("switch", { name: /Name new chats by what they are about/ });
  await expect(byMeaning).toBeVisible();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await expect(page.getByRole("switch", { name: /Name new chats by what they are about/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(page.getByRole("button", { name: "First message", exact: true })).toHaveCount(0);
});
