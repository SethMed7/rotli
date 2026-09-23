// Notes an older Rotli Web kept inside the browser are offered for copying
// into the connected vault — once. Not now is remembered (it no longer
// returns on every visit); Settings → General offers it again; and a browser
// copy the vault already holds is cleared without asking (2026-09-23).

import { expect, type Page, test } from "@playwright/test";

import { APP, readOpfsFile, startWithVault } from "./support";

/** An earlier Rotli Web's read-only copy, in the browser's own IndexedDB. */
async function plantBrowserCopy(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const snapshot = {
      version: 1,
      name: "old",
      files: { "Old note.md": "# Old note\n\nkept in the browser\n" },
      dirs: [],
    };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("rotli-web");
      open.onsuccess = () => {
        const tx = open.result.transaction("vault", "readwrite");
        tx.objectStore("vault").put(JSON.stringify(snapshot), "vault-import");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
}

const offer = (page: Page) => page.getByRole("dialog", { name: "Notes kept in this browser" });

test("Not now is remembered; Settings offers it again, and a copied browser store stops asking", async ({
  page,
}) => {
  await startWithVault(page);
  await plantBrowserCopy(page);
  await page.reload();
  await expect(offer(page)).toBeVisible();
  await offer(page).getByRole("button", { name: "Not now" }).click();
  await expect(offer(page)).toHaveCount(0);

  // the next visit doesn't ask again
  await page.reload();
  await expect(page.locator(".cm-content").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(offer(page)).toHaveCount(0);

  // Settings → General asks again — every time it's clicked (review of #63)
  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  const again = page.getByRole("button", { name: "Copy notes kept in this browser…" });
  await again.click();
  await expect(offer(page)).toBeVisible();
  await offer(page).getByRole("button", { name: "Not now" }).click();
  await again.click();
  await expect(offer(page)).toBeVisible();
  // copying clears the browser's copy, and Settings stops offering it
  await offer(page)
    .getByRole("button", { name: /^Copy into/ })
    .click();
  await expect(offer(page)).toContainText("Copied 1 file");
  expect(await readOpfsFile(page, "Old note.md")).toContain("kept in the browser");
  await offer(page).getByRole("button", { name: "Done" }).click();
  await expect(again).toHaveCount(0);
  await page.goto(APP);
  await expect(page.locator(".cm-content").first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(offer(page)).toHaveCount(0);
});

test("a browser copy the vault already holds is cleared without asking", async ({ page }) => {
  await startWithVault(page);
  await plantBrowserCopy(page);
  // copied on an earlier visit: the same file is already in the vault
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const writable = await (await root.getFileHandle("Old note.md", { create: true })).createWritable();
    await writable.write("# Old note\n\nkept in the browser\n");
    await writable.close();
  });
  await page.reload();
  await expect(page.locator(".cm-content").first()).toBeVisible();
  await page.waitForTimeout(800);
  await expect(offer(page)).toHaveCount(0);
  const left = await page.evaluate(
    () =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open("rotli-web");
        open.onsuccess = () => {
          const get = open.result.transaction("vault").objectStore("vault").get("vault-import");
          get.onsuccess = () => resolve(get.result ?? null);
        };
      }),
  );
  expect(left).toBeNull();
  // and Settings has nothing to offer
  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Export vault (.zip)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy notes kept in this browser…" })).toHaveCount(0);
});
