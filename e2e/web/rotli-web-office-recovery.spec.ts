// Rotli Web office recovery: the editor must replay a draft made inside the
// 800 ms autosave window before opening either conventional file.
import { expect, test, type Page } from "@playwright/test";

import { decodeDocx } from "../../src/documents/codec/docx";
import { createDocxBase64 } from "../../src/documents/create";
import { fillFromCsvRows, loadXlsx, newWorkbook, saveXlsx } from "../../src/sheets/codec/xlsx";
import {
  APP,
  plantOpfsBinary,
  plantOpfsFiles,
  readOpfsBase64,
  rememberOpfsVault,
  vaultGate,
} from "./support";

async function startWithBinary(page: Page, path: string, base64: string): Promise<void> {
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await plantOpfsFiles(page, { "wiki/anchor.md": "# Anchor\n" });
  await plantOpfsBinary(page, { [path]: base64 });
  await rememberOpfsVault(page);
  await page.reload();
  // boot opens the freshest note; a click made before that lands is replaced
  await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText("Anchor");
  await page.locator(".sb-system .frow", { hasText: "Assets" }).click();
  await page.locator(`.system-browser [data-note-id="${path}"]`).first().dblclick();
}

async function hasOfficeJournal(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    Object.keys(window.localStorage).some(
      (key) => key.startsWith("rotli-office-unsaved:") && key.includes(":draft:"),
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

test("opening a second tab leaves a live workbook draft and its source untouched", async ({
  page,
  context,
}) => {
  const path = "storage/peer-budget.xlsx";
  const bytes = await saveXlsx(fillFromCsvRows(newWorkbook(), "Budget", [["before"]]));
  const original = Buffer.from(bytes).toString("base64");
  await startWithBinary(page, path, original);
  await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-editor"))).toBe(true);
  await page.clock.pauseAt(new Date()); // keep Tab A inside the autosave window while Tab B boots
  await page.keyboard.type("peer edit");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const key = Object.keys(window.localStorage).find(
          (candidate) => candidate.startsWith("rotli-office-unsaved:") && candidate.includes(":draft:"),
        );
        return key ? { key, value: window.localStorage.getItem(key) } : null;
      }),
    )
    .not.toBeNull();
  // Read the exact journal record after the poll; shared localStorage must
  // still contain these bytes after the second tab completes boot.
  const before = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find(
      (candidate) => candidate.startsWith("rotli-office-unsaved:") && candidate.includes(":draft:"),
    );
    return key ? { key, value: window.localStorage.getItem(key) } : null;
  });
  expect(before).not.toBeNull();
  const peer = await context.newPage();
  try {
    await peer.goto(APP);
    // tab layout is shared, so the peer reopens the workbook tab. Office
    // replay is awaited in vault connect, before the app renders, so a tab
    // strip means replay already ran. (The context's paused clock also holds
    // the peer's editor at "Loading…", which this test doesn't need.)
    await expect(peer.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(
      "peer-budget.xlsx",
    );
    expect(await peer.evaluate((key) => window.localStorage.getItem(key), before!.key)).toBe(before!.value);
    expect(await readOpfsBase64(peer, path)).toBe(original);
  } finally {
    await peer.close();
  }
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
