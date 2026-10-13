import { expect, type Page, test } from "@playwright/test";

import { plantOpfsFiles, readOpfsFile, startWithFolder } from "./support";

const NOTE =
  "---\nid: parity-note\ncreated: 2026-03-01\ncustom: original\n---\n# Parity note\n\nA synthetic note.\n";
const MAIN = '{"version":1,"tree":[{"note":"parity-note"}]}';
// A Rotli vault carries its marker; without it the folder was opened in place.
const MARKER = '{"id":"mx_e2emetadata01","contract":"3.4"}\n';

async function openThroughSearch(page: Page, title: string) {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill(title);
  await page.locator(".prow", { hasText: title }).first().click();
}

// Boot opens the freshest note (or restores the last tab); wait for it so a
// click made mid-boot isn't replaced by that open.
async function booted(page: Page, tab = "Parity note") {
  await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText(tab);
}

async function assets(page: Page) {
  await page.locator(".sb-system .frow", { hasText: "Assets" }).click();
  await expect(page.locator(".system-browser")).toBeVisible();
}

// The direct web AI corpus exclusion is covered by webMetadataFiles.test.ts;
// this proves the real menu writes the durable security fact across reboot.
test("mark secure writes frontmatter and protected home, and survives reload", async ({ page }) => {
  await startWithFolder(page, {
    "memex.json": MARKER,
    "wiki/parity-note.md": NOTE,
    ".rotli/main.json": MAIN,
  });
  await booted(page);
  const row = page.locator('.main-tree [data-main-id="parity-note"]').first();
  await row.click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Mark secure — block remote AI", exact: true }).click();
  const secured = "wiki/_secure/parity-note.md";
  await expect.poll(() => readOpfsFile(page, secured)).toContain("secure: true");
  await expect.poll(() => readOpfsFile(page, ".gitignore")).toContain(secured);
  await page.reload();
  await openThroughSearch(page, "Parity note");
  await page.locator('.main-tree [data-main-id="parity-note"]').first().click({ button: "right" });
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Remove secure protection", exact: true }),
  ).toBeVisible();
  expect(await readOpfsFile(page, secured)).toContain("secure_origin: wiki");
  await page.keyboard.press("Escape");
  await openThroughSearch(page, "Hand to AI");
  await expect(page.getByRole("dialog", { name: "Hand to AI" })).toContainText(
    "secure notes never go to a remote AI",
  );
});

test("in a folder opened in place, mark secure keeps the note where it is", async ({ page }) => {
  // no marker: an Obsidian or Markdown folder the person brought
  await startWithFolder(page, { "wiki/parity-note.md": NOTE, ".rotli/main.json": MAIN });
  await booted(page);
  await page.locator('.main-tree [data-main-id="parity-note"]').first().click({ button: "right" });
  await page.getByRole("menuitemcheckbox", { name: "Mark secure — block remote AI", exact: true }).click();
  await expect.poll(() => readOpfsFile(page, "wiki/parity-note.md")).toContain("secure: true");
  expect(await readOpfsFile(page, "wiki/parity-note.md")).not.toContain("secure_origin");
  expect(await readOpfsFile(page, "wiki/_secure/parity-note.md")).toBe("");
  await expect.poll(() => readOpfsFile(page, ".gitignore")).toContain("wiki/parity-note.md");
  await page.reload();
  await booted(page);
  await page.locator('.main-tree [data-main-id="parity-note"]').first().click({ button: "right" });
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Remove secure protection", exact: true }),
  ).toBeVisible();
});

test("Show file metadata persists an edit and visibly refuses reserved fields", async ({ page }) => {
  await startWithFolder(page, { "wiki/parity-note.md": NOTE, ".rotli/main.json": MAIN });
  await booted(page);
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  await page.getByRole("button", { name: "General", exact: true }).click();
  await page.getByRole("switch", { name: /^Show file metadata/ }).click();
  // Settings is a toggle; return through the same real control.
  await page
    .getByRole("button", { name: /^Settings/ })
    .first()
    .click();
  await openThroughSearch(page, "Parity note");
  const metadata = page.locator(".rotli-fm-text");
  await expect(metadata).toHaveValue(/custom: original/);
  await metadata.fill((await metadata.inputValue()).replace("custom: original", "custom: persisted"));
  await metadata.press("Tab");
  await expect.poll(() => readOpfsFile(page, "wiki/parity-note.md")).toContain("custom: persisted");
  // the setting is durable too: the debounced writer lands it before the reload
  await expect
    .poll(async () => JSON.parse((await readOpfsFile(page, ".rotli/settings.json")) || "{}").fileMetadata)
    .toBe("show");
  await page.reload();
  await openThroughSearch(page, "Parity note");
  await expect(metadata).toHaveValue(/custom: persisted/);
  await metadata.fill((await metadata.inputValue()).replace("id: parity-note", "id: invented"));
  await metadata.press("Tab");
  await expect(page.locator(".rotli-fm-err")).toContainText("managed by Rotli");
  expect(await readOpfsFile(page, "wiki/parity-note.md")).toContain("id: parity-note");
  expect(await readOpfsFile(page, "wiki/parity-note.md")).not.toContain("invented");
});

test("Assets lists mixed files, opens local image and CSV, and saves CSV across reload", async ({ page }) => {
  await startWithFolder(page, { "wiki/parity-note.md": NOTE });
  await plantOpfsFiles(page, {
    "storage/picture.svg":
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="green"/></svg>',
    "storage/values.csv": "Name,Count\nSynthetic,7\n",
    "storage/movie.mp4": "synthetic placeholder",
    "storage/reference.pdf": "%PDF-1.4\nsynthetic placeholder",
    "storage/page.html": "<!doctype html><h1>Offline page</h1>",
    "storage/letter.docx": "synthetic unsupported fixture",
    "storage/budget.xlsx": "synthetic unsupported fixture",
  });
  await page.reload();
  await booted(page);
  await assets(page);
  for (const file of [
    "picture.svg",
    "values.csv",
    "movie.mp4",
    "reference.pdf",
    "page.html",
    "letter.docx",
    "budget.xlsx",
  ])
    await expect(page.locator(`.system-browser [data-note-id="storage/${file}"]`).first()).toBeVisible();
  await page.locator('.system-browser [data-note-id="storage/picture.svg"]').first().dblclick();
  const image = page.locator(".file-surface img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(24);
  const mediaUrl = await image.getAttribute("src");
  expect(mediaUrl).toMatch(/^blob:/);
  await expect(
    page.getByRole("button", { name: /Open externally|Reveal in Finder|Open with default app/ }),
  ).toHaveCount(0);

  await assets(page);
  await page.locator('.system-browser [data-note-id="storage/values.csv"]').first().dblclick();
  await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (url) => {
        try {
          await fetch(url!);
          return false;
        } catch {
          return true;
        }
      }, mediaUrl),
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-editor"))).toBe(true);
  // The spreadsheet opens with A1 selected. Use its actual cell input.
  await page.keyboard.type("Updated column");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => readOpfsFile(page, "storage/values.csv"), { timeout: 15_000 })
    .toContain("Updated column");
  await page.reload();
  await booted(page, "values.csv");
  await assets(page);
  await page.locator('.system-browser [data-note-id="storage/values.csv"]').first().dblclick();
  await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
  expect(await readOpfsFile(page, "storage/values.csv")).toContain("Updated column");
  await expect(page.getByRole("button", { name: /Open externally|Reveal in Finder/ })).toHaveCount(0);
  await openThroughSearch(page, "values.csv");
  // Rotli's own tab strip, not the spreadsheet's internal sheet tabs
  await expect(page.locator(".tabstrip").getByRole("tab", { selected: true })).toContainText("values.csv");
});

test("web office files say what is wrong, legacy formats say how to get a DOCX, and HTML reads the actual file", async ({
  page,
}) => {
  await startWithFolder(page, {
    "wiki/parity-note.md": NOTE,
    "storage/letter.docx": "synthetic package placeholder",
    "storage/budget.xlsx": "synthetic package placeholder",
    "storage/memo.doc": "synthetic legacy placeholder",
    "storage/reference.pdf": "%PDF-1.4 synthetic placeholder",
    "storage/page.html": "<!doctype html><h1>Local HTML content</h1>",
  });
  await booted(page);
  // a damaged package is named in plain words — never the zip library's text
  for (const [file, says] of [
    ["letter.docx", "isn’t a readable Word document"],
    ["budget.xlsx", "isn’t a readable Excel workbook"],
  ] as const) {
    await assets(page);
    await page.locator(`.system-browser [data-note-id="storage/${file}"]`).first().dblclick();
    await expect(page.getByRole("alert").first()).toContainText(says);
    await expect(page.getByRole("alert").first()).not.toContainText("central directory");
  }
  // conversion and the outside apps are Mac-only: the web says how to get a DOCX
  await assets(page);
  await page.locator('.system-browser [data-note-id="storage/memo.doc"]').first().dblclick();
  await expect(page.locator(".file-document-fallback")).toContainText(".doc can’t be edited on the web");
  await expect(page.locator(".file-document-fallback")).toContainText("save a .docx copy into this vault");
  await expect(page.getByRole("button", { name: /Convert copy to DOCX|Open externally/ })).toHaveCount(0);
  await assets(page);
  await page.locator('.system-browser [data-note-id="storage/reference.pdf"]').first().dblclick();
  await expect(page.locator(".file-head")).toContainText("To edit, export a .docx copy in another app");
  await expect(
    page.getByRole("button", { name: /Open externally|Convert to DOCX|Convert copy to DOCX/ }),
  ).toHaveCount(0);
  await assets(page);
  await page.locator('.system-browser [data-note-id="storage/page.html"]').first().dblclick();
  await expect(page.frameLocator(".file-html").getByRole("heading")).toHaveText("Local HTML content");
});
