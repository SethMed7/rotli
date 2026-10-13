import { expect, test } from "@playwright/test";
import JSZip from "jszip";

import { createDocxBase64 } from "../../src/documents/create";
import { fillFromCsvRows, newWorkbook, saveXlsx } from "../../src/sheets/codec/xlsx";
import { listOpfsFiles, plantOpfsBinary, plantOpfsFiles, readOpfsBase64, startWithVault } from "./support";

test("search never offers native window or vault-refresh actions", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  const search = page.getByRole("combobox", { name: "Search notes and actions" });
  for (const name of [
    "Quick capture",
    "Quick note",
    "Open or hide Rotli",
    "Refresh current vault",
    "Hide Rotli",
    "Open web browser",
    "Open a private browser",
    "Jump into the sidebar",
  ]) {
    await search.fill(name);
    await expect(page.getByRole("option", { name: new RegExp(name, "i") })).toHaveCount(0);
  }
});

test("note chat actions open the web setup guide when no helper is connected", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  const search = page.getByRole("combobox", { name: "Search notes and actions" });
  for (const title of ["Chat with this note", "New chat about this note"]) {
    await search.fill(title);
    await page.getByRole("option", { name: new RegExp(title) }).click();
    await expect(page.getByRole("dialog", { name: "Chat on the web" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "invoke" })).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "Chat on the web" })
      .getByRole("button", { name: /Close/ })
      .click();
    await page
      .getByRole("button", { name: /Search notes and actions/ })
      .first()
      .click();
  }
  await page.keyboard.press("Escape");
  for (const title of ["Chat with this note", "New chat about this note"]) {
    await page.locator(".ed-head").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: title }).click();
    await expect(page.getByRole("dialog", { name: "Chat on the web" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "invoke" })).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "Chat on the web" })
      .getByRole("button", { name: /Close/ })
      .click();
  }
});

test("the palette never suggests a note in an unnamed system target", async ({ page }) => {
  await startWithVault(page);
  await page.locator(".sb-system .frow", { hasText: "Library" }).click();
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  await expect(page.getByRole("option", { name: "New note in “”" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "New note", exact: true })).toBeVisible();
});

test("Settings explains desktop runtime limits and keeps connected CLI configuration", async ({ page }) => {
  await startWithVault(page);
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Librarian", exact: true }).click();
  await expect(page.getByText("The Librarian is available in Rotli for Mac.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now", exact: true })).toHaveCount(0);
  await expect(page.getByText(/Pass queued/)).toHaveCount(0);
  await page.getByRole("button", { name: "AI Models", exact: true }).click();
  await expect(page.getByText("Local models are available in Rotli for Mac.", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(Scan my Mac|Install|Uninstall|Make default)$/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Connected models" })).toBeVisible();
});

test("web mounts document, workbook, and CSV embeds and creates a document from the slash picker", async ({
  page,
}) => {
  await startWithVault(page);
  const docx = await createDocxBase64({
    title: "Example",
    blocks: [{ kind: "paragraph", text: "Embedded paragraph" }],
  });
  const xlsx = Buffer.from(
    await saveXlsx(fillFromCsvRows(newWorkbook(), "Sheet1", [["Embedded cell"]])),
  ).toString("base64");
  await plantOpfsBinary(page, { "storage/example.docx": docx, "storage/example.xlsx": xlsx });
  await plantOpfsFiles(page, {
    "storage/example.csv": "Name,Count\nSynthetic,7\n",
    "wiki/embed-limits.md":
      "# Embed limits\n\n```document\nstorage/example.docx\n```\n\n```sheet\nstorage/example.xlsx\n```\n\n```sheet\nstorage/example.csv\n```\n\nEnd.",
  });
  await page.reload();
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  await page.getByRole("combobox").fill("Embed limits");
  await expect(page.getByRole("option").first()).toContainText("Embed limits");
  await page.getByRole("option").first().click();
  // every embed mounts its editor; none is withheld as Mac-only
  await expect(page.locator('.rotli-render-embed[data-lang="document"] canvas').first()).toBeVisible();
  const sheets = page.locator('.rotli-render-embed[data-lang="sheet"]');
  await expect(sheets).toHaveCount(2);
  await expect(sheets.nth(0).locator("canvas").first()).toBeVisible();
  await expect(sheets.nth(1).locator("canvas").first()).toBeVisible();
  await expect(page.getByText(/opens in Rotli for Mac/)).toHaveCount(0);

  // /document offers the picker and its Create row writes a real DOCX
  await page.getByRole("button", { name: /^New Markdown note tab/ }).click();
  await page.locator(".pane.focused .cm-content").click();
  await page.keyboard.type("/document");
  await page
    .getByRole("menuitem", { name: /Document/ })
    .first()
    .click();
  const create = page.getByRole("menuitem", { name: /Create new/ });
  await expect(create).toBeEnabled();
  await create.click();
  // the fence lands in the note: its embed, or its source while the caret sits in it
  await expect(
    page
      .locator(
        '.pane.focused .rotli-render-embed[data-lang="document"], .pane.focused .cm-line:has-text("storage/rotli/untitled-")',
      )
      .first(),
  ).toBeVisible();
  await expect
    .poll(() => listOpfsFiles(page, "storage/rotli"))
    .toContainEqual(expect.stringMatching(/\.docx$/));
  const [created] = (await listOpfsFiles(page, "storage/rotli")).filter((name) => name.endsWith(".docx"));
  const zip = await JSZip.loadAsync(await readOpfsBase64(page, `storage/rotli/${created}`), { base64: true });
  expect(zip.file("word/document.xml")).not.toBeNull();
});

test("a folder vault refreshes its listing when the page regains focus", async ({ page }) => {
  await startWithVault(page);
  await plantOpfsFiles(page, { "wiki/focus-added.md": "# Focus added\n\nFrom another app.\n" });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page
    .getByRole("button", { name: /Search notes and actions/ })
    .first()
    .click();
  await page.getByRole("combobox").fill("Focus added");
  await expect(page.getByRole("option", { name: /Focus added/ })).toBeVisible();
});
