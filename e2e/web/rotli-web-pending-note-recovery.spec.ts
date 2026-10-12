import { expect, test } from "@playwright/test";

import { listOpfsFiles, readOpfsFile, startWithVault } from "./support";

test("typing before a new note is created survives a hard reload in the vault", async ({ page }) => {
  await startWithVault(page);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const wiki = await root.getDirectoryHandle("wiki");
    const welcome = await wiki.getDirectoryHandle("Welcome");
    const handle = await welcome.getFileHandle("Welcome to Rotli.md");
    const prototype = Object.getPrototypeOf(handle) as FileSystemFileHandle;
    const createWritable = Reflect.get(prototype, "createWritable") as FileSystemFileHandle["createWritable"];
    prototype.createWritable = function (
      this: FileSystemFileHandle,
      options?: FileSystemCreateWritableOptions,
    ) {
      if (this.name.endsWith(".md") && this.name !== "Welcome to Rotli.md") return new Promise(() => {});
      return createWritable.call(this, options);
    };
  });
  // the tab strip's + opens the new note's tab at once, before its file exists
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.type("# Before creation\n\nwords that must survive");
  await expect(page.locator(".pane.focused .cm-content")).toContainText("words that must survive");
  await page.reload();
  await expect
    .poll(async () => {
      const names = await listOpfsFiles(page, "wiki/_inbox");
      const texts = await Promise.all(names.map((name) => readOpfsFile(page, `wiki/_inbox/${name}`)));
      return texts.some((text) => text.includes("words that must survive"));
    })
    .toBe(true);
});

test("a failed new-note write keeps typed words until recovery", async ({ page }) => {
  await startWithVault(page);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await (
      await (await root.getDirectoryHandle("wiki")).getDirectoryHandle("Welcome")
    ).getFileHandle("Welcome to Rotli.md");
    const prototype = Object.getPrototypeOf(handle) as FileSystemFileHandle;
    const createWritable = Reflect.get(prototype, "createWritable") as FileSystemFileHandle["createWritable"];
    prototype.createWritable = function (
      this: FileSystemFileHandle,
      options?: FileSystemCreateWritableOptions,
    ) {
      if (this.name.endsWith(".md") && this.name !== "Welcome to Rotli.md") {
        return new Promise((_, reject) => {
          (window as Window & { rejectPendingNote?: () => void }).rejectPendingNote = () =>
            reject(new Error("disk full"));
        });
      }
      return createWritable.call(this, options);
    };
  });
  // the tab strip's + opens the new note's tab at once, before its file exists
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.type("# Draft after failure\n\nkeep these words");
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as Window & { rejectPendingNote?: () => void }).rejectPendingNote),
    )
    .toBe("function");
  await page.evaluate(() => (window as Window & { rejectPendingNote?: () => void }).rejectPendingNote?.());
  await expect(page.getByRole("alert").filter({ hasText: "disk full" })).toBeVisible();
  await expect(page.locator(".pane.focused .cm-content")).toContainText("keep these words");
  await page.reload();
  await expect
    .poll(async () => {
      const names = await listOpfsFiles(page, "wiki/_inbox");
      const texts = await Promise.all(names.map((name) => readOpfsFile(page, `wiki/_inbox/${name}`)));
      return texts.some((text) => text.includes("keep these words"));
    })
    .toBe(true);
});
