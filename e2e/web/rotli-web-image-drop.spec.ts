// Rotli Web keeps a dropped image the way the app does: the bytes land in the
// vault's asset store, the note gets the same portable `storage:` link, and
// the editor renders it from the vault's own file. A chat drop is refused with a notice (the helper carries text only).

import { expect, test } from "@playwright/test";

import { readOpfsBase64, readOpfsFile, startWithVault } from "./support";

// a 1×1 PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("an image dropped on a note is stored in the vault, linked with storage:, and rendered", async ({
  page,
}) => {
  await startWithVault(page);
  // the open note's editor (another mounted editor would take the drop otherwise)
  const editor = page.locator(".cm-content:visible", { hasText: "Things to try" }).first();

  await editor.evaluate((host, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], "shot.png", { type: "image/png" });
    const data = new DataTransfer();
    data.items.add(file);
    const box = host.getBoundingClientRect();
    host.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        // near the top, on screen: the editor only renders lines in view
        clientX: box.left + 10,
        clientY: box.top + 40,
      }),
    );
  }, PNG_BASE64);

  // the link is the app's, and the image shows from the stored bytes
  await expect(editor.locator('img[src^="blob:"]').first()).toBeVisible();
  // the bytes are a real file in the vault's storage/
  await expect
    .poll(() => readOpfsBase64(page, "storage/images/shot.png"), { timeout: 10_000 })
    .toBe(PNG_BASE64);
  // …and the note itself carries the portable link (the autosave is debounced)
  await expect
    .poll(() => readOpfsFile(page, "wiki/Welcome/Welcome to Rotli.md"), { timeout: 10_000 })
    .toContain("![](storage:images/shot.png)");
  // …and the image is back from the vault after a reload
  await page.reload();
  await expect(
    page
      .locator(".cm-content:visible", { hasText: "Things to try" })
      .first()
      .locator('img[src^="blob:"]')
      .first(),
  ).toBeVisible();
});
