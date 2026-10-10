// A link on a board shape opens (2026-10-08). Excalidraw's own fallback is
// window.open into a fresh blank window, which the Mac app's webview ignores —
// every board link was a dead click. Rotli now takes the click: a web address
// goes through the app's link opener (the browser's here), a [[note]] opens
// the note's tab.

import { expect, type Page, test } from "@playwright/test";

import { startWithFolder } from "./support";

function shape(id: string, x: number, link: string) {
  return {
    id,
    type: "rectangle",
    x,
    y: 120,
    width: 160,
    height: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link,
    locked: false,
  };
}

const BOARD = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "rotli",
  elements: [shape("web", 80, "https://example.com/from-a-board"), shape("note", 320, "[[Garden plan]]")],
  appState: {},
  files: {},
});

async function openBoard(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("Linked board");
  await page.locator(".prow", { hasText: "Linked board" }).first().click();
  await expect(page.locator(".canvas-surface canvas.static")).toBeVisible();
}

/** Click the link icon Excalidraw draws just off a linked shape's top-right
 * corner (the board opens at 100%, unscrolled: scene = canvas pixels). */
async function followLink(page: Page, sceneX: number): Promise<void> {
  const box = await page.locator(".canvas-surface canvas.interactive").boundingBox();
  if (!box) throw new Error("no canvas");
  const icon = { x: box.x + sceneX + 160 + 8, y: box.y + 120 - 8 };
  await page.mouse.move(icon.x, icon.y);
  await page.mouse.click(icon.x, icon.y);
}

test.beforeEach(async ({ page }) => {
  await startWithFolder(page, {
    "Garden plan.md": "# Garden plan\n\nTomatoes by the fence.\n",
    "Notes.md": "# Notes\n\nA start.\n",
    "Linked board.excalidraw": BOARD,
  });
  await expect(page.getByRole("tab", { selected: true })).toBeVisible();
});

test("a web link on a shape opens through the app's link opener", async ({ page }) => {
  await openBoard(page);
  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { opened: string[] }).opened = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await followLink(page, 80);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened))
    .toEqual(["https://example.com/from-a-board"]);
  // the board stays where it was
  await expect(page.locator(".canvas-surface canvas.static")).toBeVisible();
});

test("a [[note]] link on a shape opens that note's tab", async ({ page }) => {
  await openBoard(page);
  await followLink(page, 320);
  await expect(page.getByRole("tab", { selected: true })).toContainText("Garden plan");
  await expect(page.locator(".pane.focused .cm-content")).toContainText("Tomatoes by the fence.");
});
