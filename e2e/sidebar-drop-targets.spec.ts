// An image dragged onto the sidebar (2026-09-17): a Main note row lights up
// and springs open after a short dwell, on the DataTransfer lane this twin
// runs (the app's native channel takes the same path in nativeFileDrop.ts).

import { expect, type Locator, test } from "@playwright/test";

import { gotoApp } from "./support";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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
          clientY: box.top + box.height / 2,
          relatedTarget: null,
        }),
      );
    },
    { base64: PNG_BASE64, type },
  );
}

test("holding an image over a Main note row lights it and springs the note open", async ({ page }) => {
  await gotoApp(page);
  // the twin's Main starts empty: make the target note, then leave it for another
  await page.keyboard.press("Meta+T");
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText("# Spring open me\n");
  const row = page.locator(".main-tree .main-row", { hasText: "Spring open me" }).first();
  await expect(row).toBeVisible();
  await page.keyboard.press("Meta+T");
  await page.locator(".cm-content").last().click();
  await page.keyboard.insertText("# Somewhere else\n");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Somewhere else");

  await dragEvent(row, "dragover");
  await expect(row).toHaveAttribute("data-drop-over", "row");
  // the dwell (SPRING_OPEN_MS) opens the note without another event
  await expect(page.getByRole("tab", { selected: true })).toContainText("Spring open me", { timeout: 3000 });

  await dragEvent(row, "dragleave");
  await expect(row).not.toHaveAttribute("data-drop-over", /.+/);
});

// The chat-row case needs a chat in the sidebar; this twin seeds none, so it
// lives in the web lane beside the imported-vault fixture that has chats
// (e2e/web/rotli-web-imported-sync.spec.ts). The app's own row drop (open the
// chat, attach) rides the native channel: the owner's drag proves it.
