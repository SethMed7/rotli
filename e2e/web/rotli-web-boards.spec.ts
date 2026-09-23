// Rotli Web boards: an Excalidraw board is a real `.excalidraw` file in the
// connected vault folder, exactly as on the Mac. Created from the ⌘N chooser
// (reached through the palette — real controls, no chord), drawn on, saved
// into the folder, and still listed and openable after a reload. Documents
// (DOCX) stay a desktop capability: the chooser names them coming soon.

import { expect, type Page, test } from "@playwright/test";

import { readOpfsFile, startWithVault } from "./support";

const EMPTY_SCENE =
  '{"type":"excalidraw","version":2,"source":"rotli","elements":[],"appState":{},"files":{}}';

async function openChooser(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await expect(page.locator(".ni-surface")).toBeVisible();
}

/** Every request that left the page's origin, and every same-origin request
 * that failed (a font the build doesn't ship would show up here). */
function watchRequests(page: Page): { foreign: string[]; failed: string[]; fonts: string[] } {
  const seen = { foreign: [] as string[], failed: [] as string[], fonts: [] as string[] };
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (url.hostname !== "localhost") seen.foreign.push(request.url());
    if (url.pathname.endsWith(".woff2")) seen.fonts.push(request.url());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) seen.failed.push(`${response.status()} ${response.url()}`);
  });
  return seen;
}

test("a board is created from the chooser, drawn on, saved into the vault folder, and reopens after a reload", async ({
  page,
}) => {
  await startWithVault(page);
  const requests = watchRequests(page);

  await openChooser(page);
  await page
    .locator(".ni-surface")
    .getByRole("button", { name: /^New Board/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Name Excalidraw board" });
  await dialog.getByRole("textbox", { name: "Board name" }).fill("Launch plan");
  await dialog.getByRole("button", { name: "Create board" }).click();

  // the file exists at birth, in the memex board lane, as the empty scene
  const path = "storage/excalidraw/Launch plan.excalidraw";
  await expect.poll(() => readOpfsFile(page, path), { timeout: 10_000 }).toBe(EMPTY_SCENE);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Launch plan");

  // draw a rectangle with Excalidraw's own toolbar and pointer
  const canvas = page.locator(".canvas-surface canvas.interactive");
  await expect(canvas).toBeVisible();
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  await expect(page.locator('[data-testid="toolbar-rectangle"]')).toBeChecked();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the board canvas has no layout");
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();

  // and a label — text is what makes the canvas fetch its hand-drawn font
  await page.locator('label:has([data-testid="toolbar-text"])').click();
  await page.mouse.click(box.x + 60, box.y + 60);
  await page.keyboard.type("Ship it");
  await page.keyboard.press("Escape");

  // the debounced save writes the strokes into the folder
  await expect
    .poll(
      async () => JSON.parse((await readOpfsFile(page, path)) || "{}") as { elements?: { type: string }[] },
      { timeout: 10_000 },
    )
    .toMatchObject({ type: "excalidraw", elements: [{ type: "rectangle" }, { type: "text" }] });
  // the canvas font came from the app's own files (/app/fonts, where the web
  // build ships them — the site's /fonts is a different folder)
  const canvasFonts = requests.fonts.filter((url) => new URL(url).pathname.includes("/fonts/"));
  expect(canvasFonts.length).toBeGreaterThan(0);
  expect(canvasFonts.filter((url) => !new URL(url).pathname.startsWith("/app/fonts/"))).toEqual([]);
  await expect(page.locator(".canvas-save-err")).toHaveCount(0);

  // a reload finds it listed in Main and it opens with the drawing
  await page.reload();
  const row = page.locator(".main-tree .main-row", { hasText: "Launch plan" });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Launch plan");
  await expect(page.locator(".canvas-surface canvas.interactive")).toBeVisible();
  await expect(page.locator(".canvas-placeholder")).toHaveCount(0);

  // boards never reach off this computer, and every font the canvas asked for shipped
  expect(requests.foreign).toEqual([]);
  expect(requests.failed).toEqual([]);
});

test("a second board of the same name never replaces the first", async ({ page }) => {
  await startWithVault(page);
  for (let i = 0; i < 2; i += 1) {
    await openChooser(page);
    await page
      .locator(".ni-surface")
      .getByRole("button", { name: /^New Board/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Name Excalidraw board" });
    await dialog.getByRole("textbox", { name: "Board name" }).fill("Sketch");
    await dialog.getByRole("button", { name: "Create board" }).click();
    await expect(page.getByRole("tab", { selected: true })).toContainText(i === 0 ? "Sketch" : "Sketch-2");
  }
  expect(await readOpfsFile(page, "storage/excalidraw/Sketch.excalidraw")).toBe(EMPTY_SCENE);
  expect(await readOpfsFile(page, "storage/excalidraw/Sketch-2.excalidraw")).toBe(EMPTY_SCENE);
});

test("the Document card is coming soon on the web and creates nothing", async ({ page }) => {
  await startWithVault(page);
  await openChooser(page);
  const card = page.locator(".ni-surface").getByRole("button", { name: /^New Document — Coming soon/ });
  await expect(card).toHaveAttribute("aria-disabled", "true");
  await expect(card).toContainText("Coming soon");
  // its digit is dead too: pressing 4 on the chooser creates nothing
  await page.locator(".ni-surface").press("4");
  await expect(page.getByRole("dialog", { name: "Name document" })).toHaveCount(0);
  await expect(page.locator(".ni-surface")).toBeVisible();
  // the palette offers no document command either
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("New document");
  await expect(page.locator(".prow", { hasText: "New document" })).toHaveCount(0);
});
