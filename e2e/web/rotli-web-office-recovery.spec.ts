// Activate with the web office flag flip. The editor must replay a draft made
// inside the 800 ms autosave window before opening either conventional file.
import { expect, test, type Page } from "@playwright/test";

import { decodeDocx } from "../../src/documents/codec/docx";
import { createDocxBase64 } from "../../src/documents/create";
import { launchFeatures } from "../../src/lib/featurePolicy";
import { fillFromCsvRows, loadXlsx, newWorkbook, saveXlsx } from "../../src/sheets/codec/xlsx";
import { APP, plantOpfsFiles, readOpfsBase64, rememberOpfsVault, vaultGate } from "./support";

const officeOnWeb = launchFeatures(false, "web").sheets && launchFeatures(false, "web").documents;
test.beforeEach((_, info) => {
  info.skip(!officeOnWeb, "Web office flags are intentionally off; remove this skip at the flag flip.");
});

async function startWithBinary(page: Page, path: string, base64: string): Promise<void> {
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await plantOpfsFiles(page, { "wiki/anchor.md": "# Anchor\n" });
  await page.evaluate(
    async ({ path, base64 }) => {
      const root = await navigator.storage.getDirectory();
      const parts = path.split("/");
      let folder = root;
      for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const writer = await (
        await folder.getFileHandle(parts[parts.length - 1]!, { create: true })
      ).createWritable();
      await writer.write(bytes);
      await writer.close();
    },
    { path, base64 },
  );
  await rememberOpfsVault(page);
  await page.reload();
  await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toBeVisible();
  await page.locator(".sb-system .frow", { hasText: "Assets" }).click();
  await page.locator(`.system-browser [data-note-id="${path}"]`).first().dblclick();
}

async function hasOfficeJournal(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Object.keys(window.localStorage).some(
      (key) => key.startsWith("rotli-office-unsaved:") && !key.endsWith(":kept"),
    ),
  );
}

test("an XLSX cell typed immediately before hard refresh survives", async ({ page }) => {
  const path = "storage/budget.xlsx";
  const wb = fillFromCsvRows(newWorkbook(), "Budget", [["before"]]);
  const bytes = await saveXlsx(wb);
  const original = Buffer.from(bytes).toString("base64");
  await startWithBinary(page, path, original);
  await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-editor"))).toBe(true);
  await page.keyboard.type("recovered cell");
  await page.keyboard.press("Enter");
  await expect.poll(() => hasOfficeJournal(page)).toBe(true);
  expect(await readOpfsBase64(page, path)).toBe(original); // still in debounce window
  await page.reload();
  await expect
    .poll(async () => {
      const saved = Buffer.from(await readOpfsBase64(page, path), "base64");
      if (!saved.length) return "";
      const reopened = await loadXlsx(
        saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength) as ArrayBuffer,
      );
      const cell = reopened.worksheets[0]?.getCell(1, 1).value;
      return typeof cell === "string" ? cell : "";
    })
    .toContain("recovered cell");
});

test("a DOCX paragraph typed immediately before hard refresh survives", async ({ page }) => {
  const path = "storage/letter.docx";
  const original = await createDocxBase64({
    title: "Letter",
    blocks: [{ kind: "paragraph", text: "before" }],
  });
  await startWithBinary(page, path, original);
  const canvas = page.locator(".document-editor-host canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the document canvas has no bounds");
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("recovered paragraph");
  await expect.poll(() => hasOfficeJournal(page)).toBe(true);
  expect(await readOpfsBase64(page, path)).toBe(original); // still in debounce window
  await page.reload();
  await expect
    .poll(async () => {
      const saved = await readOpfsBase64(page, path);
      if (!saved) return "";
      const document = await decodeDocx(saved, path);
      return document.document.content
        .flatMap((item) => (item.kind === "paragraph" ? item.paragraph.runs.map((run) => run.text) : []))
        .join(" ");
    })
    .toContain("recovered paragraph");
});
