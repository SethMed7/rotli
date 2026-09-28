// A board's canvas follows the theme (2026-09-27): unless the person colored a
// board, its canvas is transparent over the theme's ground, so it is the
// theme's own color and changes with it; nothing is written to the file for it.
// Settings → Appearance → Board background → White keeps boards light instead.

import { expect, type Page, test } from "@playwright/test";

import { readOpfsFile, startWithVault } from "./support";

async function newBoard(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: /Search notes and actions/ }).click();
  await page.getByPlaceholder("Search notes, files, chats, actions…").fill("choose type");
  await page.locator(".prow", { hasText: "New tab (choose type)" }).click();
  await page
    .locator(".ni-surface")
    .getByRole("button", { name: /^New Board/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Name Excalidraw board" });
  await dialog.getByRole("textbox", { name: "Board name" }).fill(name);
  await dialog.getByRole("button", { name: "Create board" }).click();
  await expect(page.locator(".canvas-surface canvas.static")).toBeVisible();
  return `storage/excalidraw/${name}.excalidraw`;
}

/** The empty canvas's own pixel, the color behind it, and the theme's ground. */
function canvasLook(page: Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".canvas-surface canvas.static") as HTMLCanvasElement;
    const [r, g, b, a] = canvas
      .getContext("2d")!
      .getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--ground");
    document.body.append(probe);
    const ground = getComputedStyle(probe).color;
    probe.remove();
    return {
      pixel: [r, g, b, a],
      behind: getComputedStyle(document.querySelector(".canvas-surface")!).backgroundColor,
      ground,
      dark: document.querySelector(".canvas-surface .excalidraw")!.classList.contains("theme--dark"),
    };
  });
}

async function darkTheme(page: Page): Promise<void> {
  for (let i = 0; i < 14; i += 1) {
    const toggle = page.getByRole("button", { name: /^Theme — / });
    if (/Dark|Charcoal|Midnight/.test((await toggle.getAttribute("aria-label")) ?? "")) return;
    await toggle.click();
  }
  throw new Error("no dark theme reached");
}

test("an uncolored board is the theme's own color, follows a theme change, and saves no background", async ({
  page,
}) => {
  await startWithVault(page);
  const path = await newBoard(page, "Theme board");

  const light = await canvasLook(page);
  expect(light.pixel[3]).toBe(0); // the canvas paints nothing; the theme shows through
  expect(light.behind).toBe(light.ground);
  expect(light.dark).toBe(false);

  await darkTheme(page);
  await expect.poll(async () => (await canvasLook(page)).dark).toBe(true);
  const dark = await canvasLook(page);
  expect(dark.pixel[3]).toBe(0);
  expect(dark.behind).toBe(dark.ground);
  expect(dark.ground).not.toBe(light.ground);

  // draw, and the save carries the drawing but no background
  const canvas = page.locator(".canvas-surface canvas.interactive");
  await page.locator('label:has([data-testid="toolbar-rectangle"])').click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the board canvas has no layout");
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => JSON.parse((await readOpfsFile(page, path)) || "{}") as { elements?: unknown[] })
    .toMatchObject({ elements: [{ type: "rectangle" }] });
  const saved = JSON.parse(await readOpfsFile(page, path)) as { appState: Record<string, unknown> };
  expect(saved.appState.viewBackgroundColor).toBeUndefined();
});

test("Board background → White keeps an uncolored board white and light, even in a dark theme", async ({
  page,
}) => {
  await startWithVault(page);
  await darkTheme(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "White", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();

  await newBoard(page, "Paper board");
  await expect.poll(async () => (await canvasLook(page)).pixel).toEqual([255, 255, 255, 255]);
  expect((await canvasLook(page)).dark).toBe(false);
});

// 2026-09-28: the selected tool and active controls were still Excalidraw's
// own violet; they take Rotli's accent in every mode.
test("a board's selected tool uses Rotli's accent, not Excalidraw's violet", async ({ page }) => {
  await startWithVault(page);
  await newBoard(page, "Accent board");
  const vendorViolet = ["#e0dfff", "#403e6a", "#030064", "#e0dfff"];
  const selectedTool = () =>
    page.evaluate(() => {
      const root = document.querySelector(".canvas-surface .excalidraw") as HTMLElement;
      return getComputedStyle(root).getPropertyValue("--color-surface-primary-container").trim();
    });
  expect(vendorViolet).not.toContain(await selectedTool());
  await darkTheme(page);
  await expect.poll(async () => (await canvasLook(page)).dark).toBe(true);
  expect(vendorViolet).not.toContain(await selectedTool());
});
