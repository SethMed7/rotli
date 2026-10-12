import { expect, test } from "@playwright/test";

import { listOpfsFiles, readOpfsFile, startWithFolder, startWithVault } from "./support";

test("editing a fenced note fills its missing identity and dates", async ({ page }) => {
  const path = "wiki/_inbox/no-id.md";
  await startWithFolder(page, { [path]: "---\ntitle: NoId\ncustom: keep\n---\n# NoId\n" });
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("NoId");
  await page.locator(".prow", { hasText: "NoId" }).first().click();
  const editor = page.locator(".pane.focused .cm-content");
  await editor.locator(".cm-line").last().click();
  await page.keyboard.press("End");
  await page.keyboard.insertText("\nA typed word.");

  await expect.poll(() => readOpfsFile(page, path), { timeout: 10_000 }).toContain("A typed word.");
  const text = await readOpfsFile(page, path);
  expect(text).toMatch(/^id: [0-9A-HJKMNP-TV-Z]{26}$/m);
  expect(text).toMatch(/^created: \S+$/m);
  expect(text).toMatch(/^updated: \d{4}-\d{2}-\d{2}$/m);
  expect(text).toContain("custom: keep");
  expect(text).not.toMatch(/^(?:id|created|updated):\s*$/m);
});

test("a new Markdown note follows its first title on disk and reopens after reload", async ({ page }) => {
  await startWithVault(page);
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  const editor = page.locator(".pane.focused .cm-content");
  await editor.click();
  await page.keyboard.type("# Chooser thing\n\nSaved in the named file.");

  await expect
    .poll(() => readOpfsFile(page, "wiki/_inbox/chooser-thing.md"), { timeout: 10_000 })
    .toContain("Saved in the named file.");
  expect(
    (await listOpfsFiles(page, "wiki/_inbox")).filter((name) => /^untitled(?: \(\d+\))?\.md$/.test(name)),
  ).toEqual([]);

  // the tab layout reaches .rotli/viewstate.json on a short debounce; a reload
  // inside it reopens the previous layout (a known web limitation, not this rule)
  const id = /^id: (\S+)$/m.exec(await readOpfsFile(page, "wiki/_inbox/chooser-thing.md"))?.[1] ?? "";
  await expect.poll(() => readOpfsFile(page, ".rotli/viewstate.json")).toContain(`"activeTabId"`);
  await expect.poll(async () => (await readOpfsFile(page, ".rotli/viewstate.json")).includes(id)).toBe(true);
  await page.reload();
  await expect(page.locator(".tabstrip [role=tab][aria-selected=true]")).toContainText("Chooser thing");
  await expect(page.locator(".pane.focused .cm-content")).toContainText("Saved in the named file.");
});
