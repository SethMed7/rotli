// Hand to AI (Round Three, 2026-09-26): a note becomes a prompt for another
// agent, opened from the palette or the note's menu, editable, and copied.

import { expect, test, type Page } from "@playwright/test";

import { centerOf, gotoApp, pointerDrag } from "./support";

test.use({ viewport: { width: 1280, height: 900 } });

async function newNote(page: Page, text: string) {
  await page.getByRole("button", { name: /^New note in / }).click();
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText(text);
}

test("the palette's Hand to AI builds an editable prompt and copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoApp(page);
  await newNote(
    page,
    "Launch checklist\n\nGet the beta out on Friday.\n\n- [x] Freeze scope\n- [ ] Write release notes",
  );

  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Hand to AI");
  await page.locator(".prow", { hasText: "Hand to AI…" }).first().click();

  const dialog = page.getByRole("dialog", { name: "Hand to AI" });
  const prompt = dialog.getByRole("textbox", { name: "Prompt" });
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue(/## Goal\n\nGet the beta out on Friday\./);
  await expect(prompt).toHaveValue(/## Open tasks\n\n- \[ \] Write release notes/);
  await expect(prompt).toHaveValue(/## Already done\n\n- \[x\] Freeze scope/);

  await prompt.press("End");
  await prompt.pressSequentially("\nUse the staging branch.");
  await dialog.getByRole("button", { name: "Copy prompt" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Copied. Paste it into your agent.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("## Open tasks");
  expect(copied).toContain("Use the staging branch.");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a note's menu offers Hand to AI and Escape closes it", async ({ page }) => {
  await gotoApp(page);
  const title = "Q3 priorities — Northstar";
  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: title });
  await pointerDrag(page, source, await centerOf(page.locator('[data-main-id="main:"]')));
  const row = page.locator(".main-tree [data-main-id]", { hasText: title });
  await row.click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Hand to AI…" }).click();

  const dialog = page.getByRole("dialog", { name: "Hand to AI" });
  await expect(dialog.getByRole("textbox", { name: "Prompt" })).toHaveValue(new RegExp(`my note "${title}"`));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
