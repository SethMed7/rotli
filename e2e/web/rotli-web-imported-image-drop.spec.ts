// Rotli Web, imported-folder mode (Safari/Firefox's lane): an image dropped on
// a note is written into the imported copy at once — the snapshot in the
// browser carries it beside the text — and is back after a reload.

import { expect, test } from "@playwright/test";

const APP = "/app/";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SNAPSHOT = {
  version: 1,
  name: "memex-copy",
  dirs: ["wiki", ".rotli"],
  files: {
    "wiki/hello.md":
      "---\nid: 01TESTNOTE0000000000000001\ntitle: Hello\nshelf: [Inbox]\n---\n\n# Hello\n\nA note.\n",
    ".rotli/main.json": JSON.stringify({ version: 1, tree: [{ note: "01TESTNOTE0000000000000001" }] }),
    ".rotli/settings.json": JSON.stringify({ onboarded: true }),
  },
};

const readImport = () =>
  new Promise<{ binaries?: Record<string, string>; files?: Record<string, string> }>((resolve) => {
    const open = indexedDB.open("rotli-web");
    open.onsuccess = () => {
      const get = open.result.transaction("vault").objectStore("vault").get("vault-import");
      get.onsuccess = () => resolve(JSON.parse(String(get.result ?? "{}")));
      get.onerror = () => resolve({});
    };
    open.onerror = () => resolve({});
  });

test("an imported copy keeps a dropped image in its snapshot, and shows it after a reload", async ({
  page,
}) => {
  await page.goto(APP);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  await page.evaluate(
    (snapshot) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("rotli-web");
        open.onsuccess = () => {
          const tx = open.result.transaction("vault", "readwrite");
          tx.objectStore("vault").put(JSON.stringify(snapshot), "vault-import");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    SNAPSHOT,
  );
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");
  const editor = page.locator(".cm-content:visible", { hasText: "A note." }).first();
  await editor.evaluate((host, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    // on the body line, below the heading (an image above the H1 would retitle the note)
    const line = [...host.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes("A note."));
    const box = (line ?? host).getBoundingClientRect();
    host.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
        clientX: box.left + 10,
        clientY: box.top + box.height / 2,
      }),
    );
  }, PNG_BASE64);
  await expect(editor.locator('img[src^="blob:"]').first()).toBeVisible();
  // the image is in the imported copy right away (saved at once, not on the debounce)
  await expect
    .poll(() => page.evaluate(readImport).then((s) => s.binaries?.["storage/images/shot.png"] ?? ""))
    .toBe(PNG_BASE64);
  // …and the note carries the app's link (the text save is debounced)
  await expect
    .poll(
      () =>
        page
          .evaluate(readImport)
          .then((s) => s.files?.["wiki/hello.md"]?.includes("![](storage:images/shot.png)")),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Hello");
  await expect(
    page.locator(".cm-content:visible", { hasText: "A note." }).first().locator('img[src^="blob:"]').first(),
  ).toBeVisible();
});
