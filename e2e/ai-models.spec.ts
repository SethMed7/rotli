// Settings → AI Models: four connected lanes in a fixed order, Antigravity
// last and off, its card honest about the account caveat. The browser twin
// cannot install or sign in (native-only), and says so instead of offering
// controls that would fail.
import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the connected lanes are listed in order with Antigravity last and off", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI Models", exact: true }).click();

  const switches = page.getByRole("switch", { name: /^Use / });
  await expect(switches).toHaveCount(4);
  const labels = await switches.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  expect(labels).toEqual([
    "Use Claude Code",
    "Use Codex",
    "Use Cursor · Code chat",
    "Use Antigravity · Gemini",
  ]);
  await expect(page.getByRole("switch", { name: "Use Antigravity · Gemini" })).toHaveAttribute(
    "aria-checked",
    "false",
  );

  // the browser twin cannot run Google's runtime and says so, offering no
  // install or sign-in control
  await expect(
    page.getByText("Google publishes the Antigravity runtime for Apple Silicon Macs only"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Install Google/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);

  // nothing in the pane overflows the window
  const pane = page.locator(".ailane").last();
  expect(await pane.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test("a lane that isn't ready shows the walkthrough with copyable commands instead of a folded hint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI Models", exact: true }).click();

  // the browser twin cannot detect a CLI, so every lane is "app only" and
  // the steps are open by default — no "How to set this up" to find first
  const claude = page.locator(".ailane", { hasText: "Claude Code" }).first();
  await expect(claude.getByText("app only")).toBeVisible();
  await expect(claude.getByText("How to set this up")).toHaveCount(0);
  await expect(claude.getByText("Install it")).toBeVisible();
  await expect(claude.getByText("npm install -g @anthropic-ai/claude-code")).toBeVisible();
  await expect(claude.getByText("Sign in, in your terminal")).toBeVisible();
  await expect(claude.getByRole("button", { name: /^Copy: claude auth login/ })).toBeVisible();
  // the install line is the tool's own for THIS OS (brew on a Mac, npm on
  // the Linux CI runner); the sign-in line is the same everywhere
  const codex = page.locator(".ailane", { hasText: "Codex" }).first();
  await expect(codex.getByText(/^(brew install codex|npm install -g @openai\/codex)$/)).toBeVisible();
  await expect(codex.getByText("codex login")).toBeVisible();
  // nothing in the walkthrough overflows the window
  expect(await claude.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});
