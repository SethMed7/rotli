// While an image hovers, the surface under it says what the drop will do
// (2026-09-17): a chat pane rings and labels itself, a note draws the drop
// line. The browser twin runs the DataTransfer lane, where the chat's cue is
// the web one ("the Helper carries text only"); the app's attach/blind cues
// share the marker and are unit-tested in chatDrop.test.ts.

import { expect, type Locator, test } from "@playwright/test";

import { gotoApp } from "./support";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Dispatch a file-carrying drag event on an element, at its top-left inset. */
async function dragEvent(target: Locator, type: "dragover" | "dragleave" | "drop"): Promise<void> {
  await target.evaluate(
    (host, { base64, type }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
      const box = host.getBoundingClientRect();
      host.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
          clientX: box.left + 10,
          clientY: box.top + 40,
          // a dragleave with no relatedTarget is the drag leaving the window
          relatedTarget: null,
        }),
      );
    },
    { base64: PNG_BASE64, type },
  );
}

test("hovering an image over a chat rings its composer and says what the drop will do", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator(".sb-chatnew").click();
  const surface = page.locator(".chat-surface");
  await expect(surface).toBeVisible();
  // the pane is the target; the composer box is what the CSS rings
  const box = surface;

  await dragEvent(box, "dragover");
  await expect(surface).toHaveAttribute("data-drop-over", "web");
  await dragEvent(box, "dragleave");
  await expect(surface).not.toHaveAttribute("data-drop-over", /.+/);

  // the drop itself clears the cue and refuses in words (the web lane)
  await dragEvent(box, "dragover");
  await expect(surface).toHaveAttribute("data-drop-over", "web");
  await dragEvent(box, "drop");
  await expect(surface).not.toHaveAttribute("data-drop-over", /.+/);
  await expect(page.getByText("drop images into a note instead")).toBeVisible();
});

test("hovering an image over a note draws the drop line, and the drop takes it away", async ({ page }) => {
  await gotoApp(page);
  await page.keyboard.press("Meta+T");
  const editor = page.locator(".cm-content").last();
  await editor.click();
  await page.keyboard.insertText("# Drop here\n\nsome text\n");

  await dragEvent(editor, "dragover");
  await expect(page.locator(".rotli-native-drop")).toHaveCount(1);
  await dragEvent(editor, "drop");
  await expect(page.locator(".rotli-native-drop")).toHaveCount(0);
  // the import itself is the web lane's proof (rotli-web-image-drop.spec.ts):
  // this twin has no asset store, so only the cue is asserted here
});
