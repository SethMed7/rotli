// Run with Bun against the in-memory browser twin, never a native/live vault.
// Example: bun scripts/capture-site.mjs http://127.0.0.1:1431 (stable preview)
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:1431");
if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) || origin.username || origin.password)
  throw new Error("Site captures must use a local browser twin.");
const output = join(import.meta.dir, "../site/public");
await mkdir(output, { recursive: true });
// The social card uses Warm Light; the theme studio's environments are the
// separate public/themes/ captures.
const targets = new Map([["Warm Light", "warm-light"]]);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin.origin || url.protocol === "data:" ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin.href);
  expect(await page.evaluate(() => "__TAURI_INTERNALS__" in window)).toBe(false);
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Breve", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText("rotli — notes first");
  await page.evaluate(() => document.fonts.ready);
  const theme = page.getByRole("button", { name: /^Theme —/ });
  async function capture(filename, width, height) {
    await page.mouse.move(0, 0);
    await expect(theme.locator(".tip")).toHaveCSS("opacity", "0");
    await page.evaluate(() => document.fonts.ready);
    const pixels = await page.screenshot({ scale: "device", animations: "disabled", caret: "hide" });
    const metadata = await sharp(pixels).metadata();
    expect(metadata.width).toBe(width * 3);
    expect(metadata.height).toBe(height * 3);
    // Lossless PNG compression preserves captured text; no upscaling/sharpening.
    await sharp(pixels).png({ compressionLevel: 9 }).toFile(join(output, filename));
    console.log(`${filename}: ${metadata.width} × ${metadata.height}`);
  }
  const captured = new Set();
  for (let step = 0; step < 14; step++) {
    const name = (await theme.getAttribute("aria-label")).replace("Theme — ", "");
    if (targets.has(name)) {
      await capture(`rotli-app-${targets.get(name)}@3x.png`, 1280, 800);
      captured.add(name);
    }
    await theme.click();
  }
  expect(captured.size).toBe(targets.size);
  // A fresh fixture: Main holds only the seeded Welcome folder and its notes.
  await page.goto(new URL("/?empty", origin).href);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open welcome folder", exact: true }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Welcome to Rotli");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Welcome" });
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  const lessons = page.locator(".main-tree button[data-main-id][data-note-id]", {
    hasText:
      /^(Welcome to Rotli|Writing and formatting|Tasks and progress|Choices and toggles|Tables and code|Links and finding|Main and named views|Files and attachments|AI and privacy|Your launch checklist)$/,
  });
  await expect(lessons).toHaveCount(10);
  await lessons.nth(2).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Tasks and progress");
  await expect(theme).toHaveAccessibleName("Theme — Warm Light");
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture("rotli-playground@3x.png", 1440, 900);
} finally {
  await browser.close();
}
