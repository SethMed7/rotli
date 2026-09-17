// A copy from the beautified editor carries the note's SOURCE Markdown as
// plain text (2026-09-17: the owner pasted a whole note into a new one and got
// "☐ task" lines and bare headings that no longer rendered). The HTML reading
// stays for rich targets. Driven through a synthetic copy event: the handler
// fills the event's DataTransfer, which the test reads back.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

const NOTE = `# Bugs

- [x] Ability to delete a folder
- [ ] Trash needs a back button
  - [ ] a nested one
1. first
2. second
`;

test("copying a note's selection puts its Markdown on the clipboard, and HTML beside it", async ({
  page,
}) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText(NOTE);
  // ControlOrMeta: CodeMirror binds select-all to Mod-a, which is Ctrl on the Linux CI runner
  await page.keyboard.press("ControlOrMeta+A");

  const copied = await editor.evaluate((content) => {
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
    content.dispatchEvent(event);
    return {
      handled: event.defaultPrevented,
      text: data.getData("text/plain"),
      html: data.getData("text/html"),
    };
  });
  expect(copied.handled).toBe(true);
  expect(copied.text.trimEnd()).toBe(NOTE.trimEnd());
  expect(copied.html).toContain("<h1>Bugs</h1>");
  expect(copied.html).toContain("<li>☑ Ability to delete a folder</li>");
});

test("pasting that Markdown into a new note renders it again", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await editor.evaluate((content, note) => {
    const data = new DataTransfer();
    data.setData("text/plain", note);
    content.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, NOTE);
  await page.locator(".cm-content .cm-line").first().click();
  await expect(page.locator(".rotli-check")).toHaveCount(3);
  await expect(page.locator(".rotli-check.done")).toHaveCount(1);
  await expect(page.locator(".cm-line.rotli-h1")).toHaveCount(1);
});
