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
  // Basic is the default; Refined needs the Librarian's model, which the
  // browser twin doesn't have
  const style = dialog.getByRole("group", { name: "Prompt style" });
  await expect(style.getByRole("button", { name: "Basic" })).toHaveAttribute("aria-pressed", "true");
  await expect(style.getByRole("button", { name: "Refined" })).toBeDisabled();
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

test("a refused clipboard says how to copy by hand", async ({ page, context }) => {
  await context.clearPermissions();
  await gotoApp(page);
  await newNote(page, "Clipboard check\n\nCopy me.");
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Hand to AI");
  await page.locator(".prow", { hasText: "Hand to AI…" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Hand to AI" });
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
  });
  await dialog.getByRole("button", { name: "Copy prompt" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Couldn’t copy. Select the prompt and press ⌘C instead.",
  );
});

// 2026-09-28, the owner looked for it as "send to AI": ⌘K finds it by that too.
test("⌘K finds Hand to AI when you search for “send to AI”", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("send to ai");
  await expect(page.locator(".prow", { hasText: "Hand to AI…" }).first()).toBeVisible();
});

// 2026-09-28, the owner: "let me do hand to ai via a slash command".
test("/hand to AI opens Hand to AI for the note, and the slash text goes", async ({ page }) => {
  await gotoApp(page);
  await newNote(page, "Launch checklist\n\nGet the beta out on Friday.\n\n");
  await page.keyboard.type("/hand");
  const menu = page.getByRole("menu", { name: "Insert block" });
  await menu.getByRole("menuitem", { name: /Hand to AI/ }).click();
  const dialog = page.getByRole("dialog", { name: "Hand to AI" });
  await expect(dialog.getByRole("textbox", { name: "Prompt" })).toHaveValue(/Get the beta out on Friday\./);
  await expect(page.locator(".cm-content").last()).not.toContainText("/hand");
});

// v2, 2026-10-02: a linked file is named in an Attachments section, and one
// that isn't in the vault is listed as missing rather than dropped.
test("an image the note links to is listed, and a missing one says so", async ({ page }) => {
  await gotoApp(page);
  await newNote(page, "Login bug\n\nFix the overlap.\n\n![Overlap|300](storage:no-such-shot.png)");
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Hand to AI");
  await page.locator(".prow", { hasText: "Hand to AI…" }).first().click();
  const prompt = page.getByRole("dialog", { name: "Hand to AI" }).getByRole("textbox", { name: "Prompt" });
  await expect(prompt).toHaveValue(
    /## Attachments\n\n.*\n\n- storage\/no-such-shot\.png \(image, “Overlap”\): missing, not found in the vault/,
  );
  await expect(prompt).toHaveValue(/\[missing file: Overlap \(storage\/no-such-shot\.png\)\]/);
  await expect(prompt).not.toHaveValue(/\|300/);
});
