// Settings → Appearance → Show in Rotli (2026-09-28; src/lib/hideable.ts): a
// switch hides a part of the chrome, what it opened stays reachable (here
// Tasks from ⌘K), and Show everything brings it all back.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("hidden parts of the chrome go away, stay reachable, and come back", async ({ page }) => {
  await gotoApp(page);
  const overview = page.getByRole("button", { name: "Open Rotli activity dashboard" });
  const tasks = page.locator(".frow", { hasText: "Tasks" });
  const theme = page.getByRole("button", { name: /^Theme — / });
  const feedback = page.locator(".sb-foot").getByRole("button", { name: "Feedback", exact: true });
  for (const shown of [overview, tasks, theme, feedback]) await expect(shown).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  for (const name of [/^Activity overview/, /^Tasks/, /^Theme/, /^Feedback/]) {
    const toggle = page.getByRole("switch", { name });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }
  await expect(page.getByRole("button", { name: "Show everything (4 hidden)" })).toBeVisible();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();

  for (const gone of [overview, tasks, theme, feedback]) await expect(gone).toHaveCount(0);
  // the footer's remaining buttons share its width, with no empty column
  const footer = await page.locator(".sb-foot").boundingBox();
  const last = await page.locator(".sb-foot .sb-footbtn").last().boundingBox();
  expect(footer && last && last.x + last.width > footer.x + footer.width - 20).toBe(true);

  // Tasks is still one ⌘K away
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Tasks");
  await page.locator(".prow", { hasText: "Tasks" }).first().click();
  await expect(page.getByRole("heading", { name: "Tasks", level: 2 })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Show everything (4 hidden)" }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  for (const back of [overview, tasks, theme, feedback]) await expect(back).toBeVisible();
});
