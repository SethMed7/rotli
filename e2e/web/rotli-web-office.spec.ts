// Rotli Web edits Word documents and Excel workbooks (Beta) in the connected
// vault, on both roads a browser has to it: the folder the person chose (the
// origin-private file system stands in for it) and a folder served by Rotli
// Helper (the fake on the loopback route, binary-safe, with the real helper's
// content gate). Every file here is real OOXML, made through real controls,
// typed into, saved, reloaded, and unzipped from the vault.

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { connectThroughHelper, fakeHelperVault, PORT, TOKEN, withoutFolderApi } from "./fake-helper";
import { budgetXlsx, letterDocx, packagePart, readXlsx } from "./office-fixtures";
import { APP, listOpfsFiles, plantOpfsBinary, readOpfsBase64, startWithVault } from "./support";

interface Road {
  /** A seeded vault with `files` written behind the page, then refocused. */
  start(files: Record<string, Buffer>): Promise<void>;
  read(path: string): Promise<Buffer | null>;
  list(folder: string): Promise<string[]>;
  /** Another app writes the file while Rotli has it open. */
  writeBehind(path: string, bytes: Buffer): Promise<void>;
}

/** The page comes back to the front: the vault listing is read again, as
 * after the person switched away to another app that changed the folder. */
async function refocus(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

function folderRoad(page: Page): Road {
  return {
    async start(files) {
      await startWithVault(page);
      await plantOpfsBinary(
        page,
        Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, bytes.toString("base64")])),
      );
      await refocus(page);
    },
    async read(path) {
      const base64 = await readOpfsBase64(page, path);
      return base64 ? Buffer.from(base64, "base64") : null;
    },
    list: (folder) => listOpfsFiles(page, folder),
    writeBehind: (path, bytes) => plantOpfsBinary(page, { [path]: bytes.toString("base64") }),
  };
}

function helperRoad(page: Page, context: BrowserContext): Road {
  const helper = fakeHelperVault();
  return {
    async start(files) {
      // a vault the person already keeps: its files are there before Rotli
      // connects (a helper vault isn't re-read on focus), and it opens a note
      helper.writeBehind("wiki/office-anchor.md", Buffer.from("# Office anchor\n"));
      for (const [path, bytes] of Object.entries(files)) helper.writeBehind(path, bytes);
      await helper.install(context);
      await withoutFolderApi(context);
      await connectThroughHelper(page, "Office anchor");
    },
    read: async (path) => helper.files.get(path)?.bytes ?? null,
    list: async (folder) =>
      [...helper.files.keys()]
        .filter((path) => path.slice(0, path.lastIndexOf("/")) === folder)
        .map((path) => path.slice(path.lastIndexOf("/") + 1))
        .sort(),
    writeBehind: async (path, bytes) => helper.writeBehind(path, bytes),
  };
}

const ROADS = [
  { name: "connected folder", make: (page: Page) => folderRoad(page) },
  { name: "Rotli Helper", make: (page: Page, context: BrowserContext) => helperRoad(page, context) },
] as const;

test("the fake Helper refuses an office write above the real 24 MiB HTTP request cap", async ({
  page,
  context,
}) => {
  const helper = fakeHelperVault();
  await helper.install(context);
  await page.goto(APP);
  const result = await page.evaluate(
    async ({ port, token }) => {
      const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          cmd: "vault_write",
          args: { path: "storage/too-large.xlsx", base64: "A".repeat(24 * 1024 * 1024) },
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { port: PORT, token: TOKEN },
  );
  expect(result).toEqual({ status: 413, body: { error: "request too large" } });
});

async function openFromAssets(page: Page, path: string): Promise<void> {
  await page.locator(".sb-system .frow", { hasText: "Assets" }).click();
  await page.locator(`.system-browser [data-note-id="${path}"]`).first().dblclick();
}

async function openChooser(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await expect(page.locator(".ni-surface")).toBeVisible();
}

/** Type into the open sheet's selected cell (A1 when it opens) and commit. */
async function typeInSheet(page: Page, text: string): Promise<void> {
  await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-editor"))).toBe(true);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

/** Type a new paragraph after the document's first line. */
async function typeInDocument(page: Page, text: string): Promise<void> {
  const canvas = page.locator(".document-editor-host.is-ready canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the document canvas has no bounds");
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
}

/** The bytes once they differ from `before` (a save landed). */
async function savedOver(road: Road, path: string, before: Buffer | null): Promise<Buffer> {
  await expect
    .poll(async () => {
      const now = await road.read(path);
      return !!now && (!before || !now.equals(before));
    })
    .toBe(true);
  return (await road.read(path))!;
}

for (const { name, make } of ROADS) {
  test.describe(`Rotli Web office files on the ${name}`, () => {
    test("a new Sheet from the chooser is a real XLSX whose typing survives a reload", async ({
      page,
      context,
    }) => {
      const road = make(page, context);
      await road.start({});
      await openChooser(page);
      const card = page.locator(".ni-surface").getByRole("button", { name: /^New Sheet/ });
      await expect(card).toContainText("Beta");
      await card.click();
      await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(".xlsx");
      await expect
        .poll(async () => (await road.list("storage/rotli")).filter((f) => f.endsWith(".xlsx")))
        .toHaveLength(1);
      const [file] = (await road.list("storage/rotli")).filter((f) => f.endsWith(".xlsx"));
      const path = `storage/rotli/${file}`;
      const blank = await road.read(path);
      await typeInSheet(page, "Typed on the web");
      const saved = await savedOver(road, path, blank);
      // the first save keeps what was there, as the Mac corpus does for any file
      expect((await road.read(`${path}.bak`))?.equals(blank!)).toBe(true);
      expect(await packagePart(saved, "xl/workbook.xml")).toContain("<sheet ");
      expect((await readXlsx(saved)).worksheets[0]!.getCell("A1").value).toBe("Typed on the web");

      await page.reload();
      await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(file!);
      await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect((await readXlsx((await road.read(path))!)).worksheets[0]!.getCell("A1").value).toBe(
        "Typed on the web",
      );
    });

    test("a new Document from the chooser is named first, a real DOCX, and its typing survives a reload", async ({
      page,
      context,
    }) => {
      const road = make(page, context);
      await road.start({});
      await openChooser(page);
      await page
        .locator(".ni-surface")
        .getByRole("button", { name: /^New Document/ })
        .click();
      const dialog = page.getByRole("dialog", { name: "Name document" });
      await dialog.getByRole("textbox", { name: "Document name" }).fill("Web plan");
      await dialog.getByRole("button", { name: "Create document" }).click();
      await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(
        "Web plan.docx",
      );
      const path = "storage/rotli/Web plan.docx";
      await expect.poll(() => road.read(path)).not.toBeNull();
      const blank = await road.read(path);
      await expect(page.locator(".file-head")).toContainText("Beta");
      await typeInDocument(page, "Typed on the web");
      const saved = await savedOver(road, path, blank);
      expect((await road.read(`${path}.bak`))?.equals(blank!)).toBe(true);
      expect(await packagePart(saved, "word/document.xml")).toContain("Typed on the web");

      await page.reload();
      await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(
        "Web plan.docx",
      );
      await expect(page.locator(".document-editor-host.is-ready canvas").first()).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(await packagePart((await road.read(path))!, "word/document.xml")).toContain("Typed on the web");
    });

    test("an existing workbook keeps its formula, number formats, and second sheet through edits and a reopen", async ({
      page,
      context,
    }) => {
      const road = make(page, context);
      const original = await budgetXlsx();
      const path = "storage/budget.xlsx";
      await road.start({ [path]: original });
      await openFromAssets(page, path);
      await typeInSheet(page, "Item edited");
      let saved = await savedOver(road, path, original);
      // the first save keeps the original beside it, once
      expect((await road.read(`${path}.bak`))?.equals(original)).toBe(true);

      // the reload reopens the workbook's tab from the vault
      await page.reload();
      await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(
        "budget.xlsx",
      );
      await typeInSheet(page, "Item reopened");
      saved = await savedOver(road, path, saved);
      const wb = await readXlsx(saved);
      const budget = wb.getWorksheet("Budget")!;
      expect(budget.getCell("A1").value).toBe("Item reopened");
      expect(budget.getCell("A2").value).toBe("Synthetic paper");
      expect(budget.getCell("B4").formula).toBe("SUM(B2:B3)");
      for (const row of [2, 3, 4]) expect(budget.getCell(`B${row}`).numFmt).toBe('"$"#,##0.00');
      const notes = wb.getWorksheet("Notes")!;
      expect(notes.getCell("A1").value).toBe("Second sheet marker");
      expect(notes.getCell("B1").value).toBe(0.375);
      expect(notes.getCell("B1").numFmt).toBe("0.0%");
      expect((await road.read(`${path}.bak`))?.equals(original)).toBe(true);
    });

    test("an existing document keeps its heading, bold run, and table through an edit and a reopen", async ({
      page,
      context,
    }) => {
      const road = make(page, context);
      const original = await letterDocx();
      const path = "storage/letter.docx";
      await road.start({ [path]: original });
      await openFromAssets(page, path);
      await typeInDocument(page, "Typed on the web");
      const saved = await savedOver(road, path, original);
      const body = await packagePart(saved, "word/document.xml");
      expect(body).toContain("Typed on the web");
      expect(body).toMatch(/<w:pStyle w:val="Heading1"\/>[\s\S]*?Synthetic Heading/);
      expect(body).toMatch(/<w:b\/>[\s\S]*?a bold run/);
      expect(body).toContain("<w:tbl>");
      for (const text of ["Cell A1", "Cell B1", "Cell A2", "Cell B2", "After the table."])
        expect(body).toContain(text);
      expect(await packagePart(saved, "word/styles.xml")).toContain('w:styleId="Heading1"');

      // the reload reopens the document's tab from the vault
      await page.reload();
      await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(
        "letter.docx",
      );
      await expect(page.locator(".document-editor-host.is-ready canvas").first()).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      // opening is not an edit: the saved package is left as it was
      expect((await road.read(path))?.equals(saved)).toBe(true);
    });

    test("an outside change is never overwritten by a stale tab: the conflict shows and the outside bytes stay", async ({
      page,
      context,
    }) => {
      const road = make(page, context);
      const original = await letterDocx();
      const outside = await letterDocx("PLAIN TEXT THEN ");
      // same size, different bytes: only the content gate can tell them apart
      expect(outside.length).toBe(original.length);
      expect(outside.equals(original)).toBe(false);
      const path = "storage/letter.docx";
      await road.start({ [path]: original });
      await openFromAssets(page, path);
      await expect(page.locator(".document-editor-host.is-ready canvas").first()).toBeVisible();
      await road.writeBehind(path, outside);
      await typeInDocument(page, "Stale tab typing");
      await expect(page.locator(".document-save-error").first()).toContainText("changed");
      await expect(page.locator(".file-head .save-status")).toContainText("Not saved");
      expect((await road.read(path))?.equals(outside)).toBe(true);
      expect(await road.read(`${path}.bak`)).toBeNull();
    });

    test("renaming a document carries its first-save backup with it", async ({ page, context }) => {
      const road = make(page, context);
      const original = await letterDocx();
      const path = "storage/letter.docx";
      await road.start({ [path]: original });
      await openFromAssets(page, path);
      await typeInDocument(page, "Before the rename");
      const saved = await savedOver(road, path, original);
      expect((await road.read(`${path}.bak`))?.equals(original)).toBe(true);

      await page
        .locator(".tabstrip")
        .getByRole("tab", { name: /letter\.docx/ })
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Rename…" }).click();
      const dialog = page.getByRole("dialog", { name: "Rename document" });
      await dialog.getByRole("textbox", { name: "Document name" }).fill("Letter final");
      await dialog.getByRole("button", { name: "Rename" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(
        "Letter final.docx",
      );
      await expect.poll(async () => (await road.read("storage/Letter final.docx"))?.equals(saved)).toBe(true);
      expect((await road.read("storage/Letter final.docx.bak"))?.equals(original)).toBe(true);
      expect(await road.read(path)).toBeNull();
      expect(await road.read(`${path}.bak`)).toBeNull();
    });
  });
}

test("an outside change to an open workbook is never overwritten by the stale tab", async ({ page }) => {
  const road = folderRoad(page);
  const original = await budgetXlsx();
  // same size, one byte different: a change no size or stamp check can see
  const outside = Buffer.from(original);
  outside[outside.length - 30] = outside[outside.length - 30]! ^ 0x01;
  const path = "storage/budget.xlsx";
  await road.start({ [path]: original });
  await openFromAssets(page, path);
  await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
  await road.writeBehind(path, outside);
  await typeInSheet(page, "Stale tab typing");
  await expect(page.locator(".sheet-save-err")).toContainText("changed");
  expect((await road.read(path))?.equals(outside)).toBe(true);
});

// Univer's sheets-ui facade mixes its event wiring into every Univer instance
// made after the sheets engine loads; on the document editor's docs-only
// injector it throws "[redi] … HoverManagerService" (minified on the web)
// inside its own RxJS subscriber. No Rotli surface shows it and nothing
// breaks — e2e/office-engine-sequence.spec.ts pins the same verdict on the
// Mac twin. This proves it through real controls: every later save lands.
const KNOWN_FACADE_NOISE = /\[redi\]: Expect 1 dependency item\(s\) for id "[^"]+" but get 0/;

test("a document opened right after a workbook in the same tab edits and saves, and so does the workbook again", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const road = folderRoad(page);
  const xlsx = await budgetXlsx();
  const docx = await letterDocx();
  await road.start({ "storage/budget.xlsx": xlsx, "storage/letter.docx": docx });

  await openFromAssets(page, "storage/budget.xlsx");
  await typeInSheet(page, "First pass");
  const sheetSaved = await savedOver(road, "storage/budget.xlsx", xlsx);

  await openFromAssets(page, "storage/letter.docx");
  await typeInDocument(page, "After the workbook");
  const docSaved = await savedOver(road, "storage/letter.docx", docx);
  expect(await packagePart(docSaved, "word/document.xml")).toContain("After the workbook");

  await openFromAssets(page, "storage/budget.xlsx");
  await typeInSheet(page, "Second pass");
  const again = await savedOver(road, "storage/budget.xlsx", sheetSaved);
  expect((await readXlsx(again)).getWorksheet("Budget")!.getCell("A1").value).toBe("Second pass");

  await expect(page.getByRole("alert")).toHaveCount(0);
  test.info().annotations.push({
    type: "univer-facade-noise",
    description: String(errors.filter((error) => KNOWN_FACADE_NOISE.test(error)).length),
  });
  expect(errors.filter((error) => !KNOWN_FACADE_NOISE.test(error))).toEqual([]);
});
