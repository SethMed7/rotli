// /about/: the maker's first-person story on its own wide layout (not the reading column):
// the story's sections in order, the links it owes (the study post, the roadmap, the maker on
// X), a timeline whose every date is a real release in CHANGELOG.md, and words and pictures
// that never overlap from 320 to 1920.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

test("the story runs in order, across the page's width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/about/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Why I’m building rotli");
  const ids = await page.locator("main > section[id]").evaluateAll((sections) => sections.map((s) => s.id));
  expect(ids).toEqual(["notes", "two-kinds", "vault", "cost", "name", "history", "who"]);
  // Wide: the words and the picture of a row sit side by side, and the island fills the grid.
  const row = page.locator("#notes");
  const [copy, art] = await Promise.all([
    row.locator(".copy").boundingBox(),
    row.locator(".art").boundingBox(),
  ]);
  expect(art!.x).toBeGreaterThan(copy!.x + copy!.width);
  const island = (await page.locator(".island-frame").boundingBox())!;
  expect(island.width).toBeGreaterThan(1100);
  await expect(page.locator(".pull")).toHaveCount(2);
});

test("it says what rotli is, and links the study, the roadmap, and the maker", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.locator("#notes")).toContainText("Docs and Sheets (beta), chat, and boards");
  await expect(page.locator("#two-kinds")).toContainText("never touches your words");
  await expect(page.locator("#cost a[href='/blog/the-ai-you-already-pay-for/']")).toHaveCount(1);
  await expect(page.locator("#history a[href='/roadmap/']")).toHaveCount(1);
  const x = page.locator("#who").getByRole("link", { name: /Follow along on X/ });
  await expect(x).toHaveAttribute("href", "https://x.com/iamsethmedina");
  await expect(x).toHaveAttribute("rel", /\bme\b/);
  await expect(page.locator("#who a[href='/download/']")).toHaveCount(1);
});

test("every date on the timeline is a release in the changelog", async ({ page }) => {
  const changelog = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8");
  const released = new Set(
    [...changelog.matchAll(/^## \[\d+\.\d+\.\d+\] - (\d{4}-\d{2}-\d{2})\s*$/gm)].map((m) => m[1]),
  );
  await page.goto("/about/");
  const dates = await page
    .locator(".timeline time")
    .evaluateAll((items) => items.map((t) => t.getAttribute("datetime")));
  expect(dates.length).toBeGreaterThanOrEqual(5);
  for (const date of dates) expect(released.has(date!)).toBe(true);
  expect(dates[0]).toBe("2026-09-15");
  await expect(page.locator(".timeline li").last()).toContainText("What’s next");
});

const intersects = (a: DOMRect, b: DOMRect) =>
  a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`words and pictures never overlap on About at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/about/");
    const pairs = await page.evaluate(() => {
      const box = (el: Element | null) => el!.getBoundingClientRect().toJSON() as DOMRect;
      const rows = [...document.querySelectorAll(".row")].map((row) => [
        box(row.querySelector(".copy")),
        box(row.querySelector(".art, .elsewhere")),
      ]);
      const timeline = [...document.querySelectorAll(".timeline li")].map((li) => [
        box(li.querySelector("time, .when")),
        box(li.querySelector("div")),
      ]);
      const raw = document.querySelector(".raw");
      return [
        [box(document.querySelector("h1")), box(document.querySelector(".head-side"))],
        [box(document.querySelector(".timeline-head")), box(document.querySelector(".timeline"))],
        [box(raw!.querySelector(".raw-quokka")), box(raw!.querySelector(".shot"))],
        [box(raw!.querySelector(".raw-quokka")), box(raw!.querySelector("figcaption"))],
        ...rows,
        ...timeline,
      ];
    });
    for (const [a, b] of pairs) expect(intersects(a!, b!)).toBe(false);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
    await context.close();
  });
}
