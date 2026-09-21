// The Chat window's shell (1.3.0), driven as `?window=chat` in the browser
// twin. What this CAN prove: the shell is chat-only — no Home, no Breve, no
// System, no Settings, and its panes never hold a note. What it cannot: the
// second native webview, the events between the two windows, and the quit
// handshake — those are the owner's native checklist (the PR says so).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the chat window shows only Chat, and its panes never hold a note", async ({ page }) => {
  await page.goto("/?window=chat");
  const shell = page.locator(".chat-window");
  await expect(shell).toBeVisible();
  await expect(shell.locator(".chat-window-title")).toHaveText("Chat");

  // main's furniture is not here: the front switch, the footer, note tabs
  await expect(page.getByRole("group", { name: "Sidebar front" })).toHaveCount(0);
  await expect(page.locator(".sb-foot")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
  // the store boots with a note placeholder — this window closed it
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(shell.getByText("No chat open")).toBeVisible();
  await expect(shell.getByRole("button", { name: "Put Chat back in the main window" })).toBeVisible();

  // the sidebar toggle works here too (2026-09-21): its button up top, and ⌘0
  const rail = shell.getByRole("complementary", { name: "Chats" });
  await expect(rail).toBeVisible();
  await shell.getByRole("button", { name: "Hide sidebar — ⌘0" }).click();
  await expect(rail).toHaveCount(0);
  await page.keyboard.press("Meta+0");
  await expect(rail).toBeVisible();

  // a new chat is a chat tab; the strip offers no way to make a note
  await shell.getByRole("button", { name: "New chat" }).first().click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".pane.focused [data-chat-pane]")).toBeVisible();
  await expect(page.locator(".tabplus")).toBeHidden();

  // ⌘T and ⌘N mean "new" here too, and new is a chat — never a note tab
  await page.keyboard.press("Meta+T");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.keyboard.press("Meta+N");
  await expect(page.getByRole("tab")).toHaveCount(3);
  // every tab is a chat: no note editor, no "choose a type" tab
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await expect(page.locator(".pane.focused [data-chat-pane]:visible")).toHaveCount(1);
  // ⌘W closes chat tabs until the window rests, still a chat window
  for (const left of [2, 1, 0]) {
    await page.keyboard.press("Meta+W");
    await expect(page.getByRole("tab")).toHaveCount(left);
  }
  await expect(shell.getByText("No chat open")).toBeVisible();
});

test("outside the Mac app there is no way to pull Chat out", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
  await expect(page.locator(".sb-switch-window")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pull Chat out/ })).toHaveCount(0);
});
