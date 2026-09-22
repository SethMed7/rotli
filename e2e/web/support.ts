// Rotli Web's E2E helpers. Every test gets a fresh browser context, so the
// first visit lands on setup ("Choose your vault" in Chromium) — a vault is
// required, so tests that want an editor connect one here, once: the
// origin-private file system hands out the same FileSystemDirectoryHandle the
// picker does, so an empty OPFS root stands in for a folder the user chose.

import { expect, type Page } from "@playwright/test";

export const APP = "/app/";

/** Setup's heading, whichever step it is on. */
export function vaultGate(page: Page) {
  return page.locator(".web-vault-gate h1");
}

/** Remember the origin-private root as this browser's vault, the way the
 * picker's handle is remembered. The page reloads into it on the next boot. */
export async function rememberOpfsVault(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("rotli-web");
      open.onsuccess = () => {
        const tx = open.result.transaction("vault", "readwrite");
        tx.objectStore("vault").put(root, "vault-handle");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
}

/** Read a file from the connected OPFS vault ("" when it doesn't exist). */
export function readOpfsFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (target) => {
    try {
      let dir = await navigator.storage.getDirectory();
      const parts = target.split("/");
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return await (await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile()).text();
    } catch {
      return "";
    }
  }, path);
}

/** First visit → setup → connect an empty folder → it becomes a new vault
 * with the Welcome lessons, and the welcome note is open. */
export async function startWithVault(page: Page, url = APP): Promise<void> {
  await page.goto(url);
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await rememberOpfsVault(page);
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
}

/** Write files into the origin-private folder (before it is connected, or
 * behind the page's back), creating folders as needed. */
export async function plantOpfsFiles(page: Page, files: Record<string, string>): Promise<void> {
  await page.evaluate(async (entries) => {
    const root = await navigator.storage.getDirectory();
    for (const [path, text] of Object.entries(entries)) {
      const parts = path.split("/");
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (
        await dir.getFileHandle(parts[parts.length - 1]!, { create: true })
      ).createWritable();
      await writable.write(text);
      await writable.close();
    }
  }, files);
}

/** First visit → a folder already holding `files` becomes this browser's vault. */
export async function startWithFolder(page: Page, files: Record<string, string>): Promise<void> {
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await plantOpfsFiles(page, files);
  await rememberOpfsVault(page);
  await page.reload();
}

/** A file's bytes from the connected OPFS vault, base64 ("" when missing). */
export function readOpfsBase64(page: Page, path: string): Promise<string> {
  return page.evaluate(async (target) => {
    try {
      let dir = await navigator.storage.getDirectory();
      const parts = target.split("/");
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      const bytes = new Uint8Array(
        await (await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile()).arrayBuffer(),
      );
      return btoa(String.fromCharCode(...bytes));
    } catch {
      return "";
    }
  }, path);
}
