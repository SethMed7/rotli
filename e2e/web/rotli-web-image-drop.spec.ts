// Rotli Web keeps a dropped image the way the app does: the bytes land in the
// vault's asset store, the note gets the same portable `storage:` link, and
// the editor renders it — here from the browser vault, on a folder from the
// real file. A chat drop is refused with a notice (the helper carries text only).

import { expect, test } from "@playwright/test";

const APP = "/app/";
// a 1×1 PNG
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("an image dropped on a note is stored in the vault, linked with storage:, and rendered", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
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
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open("rotli-web");
              open.onsuccess = () => {
                const get = open.result
                  .transaction("vault")
                  .objectStore("vault")
                  .get("asset:storage/images/shot.png");
                get.onsuccess = () => resolve(String(get.result ?? ""));
                get.onerror = () => resolve("");
              };
              open.onerror = () => resolve("");
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(PNG_BASE64);

  // the note itself carries the portable link (the autosave is debounced)…
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open("rotli-web");
              open.onsuccess = () => {
                const get = open.result.transaction("vault").objectStore("vault").get("notes");
                get.onsuccess = () =>
                  resolve(String(get.result ?? "").includes("![](storage:images/shot.png)"));
                get.onerror = () => resolve(false);
              };
              open.onerror = () => resolve(false);
            }),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
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
