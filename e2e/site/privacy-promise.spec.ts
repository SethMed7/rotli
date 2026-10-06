// The privacy promise at the top of /privacy/ (#promise; the owner, 2026-10-06): one lead line,
// a matrix of who may read and change a note you wrote (on-device model, connected AI, the
// Librarian) for an everyday, a secure, and a locked note, then five plain points. It is the
// page's first section and its one access table. On a phone each row is a block whose cells
// name their reader, and nothing runs off the side at any width. Where the reading column's middle
// has room, the matrix breaks out of the words like a post's table, never into the rail.
import { expect, test } from "@playwright/test";

const READERS = ["On-device model", "Connected AI", "The Librarian"];

test("the promise is the policy's first section, with its matrix and five points", async ({ page }) => {
  await page.goto("/privacy/");
  const promise = page.locator("#promise");
  await expect(promise).toHaveText("Our privacy promise");
  await expect(page.locator("main h2").first()).toHaveId("promise");
  // First in the rail's tree (the page reads like a blog post: privacy-page.spec.ts).
  await expect(page.locator("[data-article-rail] .rail-toc a").first()).toHaveAttribute("href", "#promise");
  // One access table on the page: the promise's.
  await expect(page.locator("main table")).toHaveCount(1);

  const matrix = page.locator(".promise-matrix table");
  await expect(matrix.locator("thead th")).toHaveText([
    /Note/,
    /On-device model/,
    /Connected AI/,
    /The Librarian/,
  ]);
  await expect(matrix.locator("tbody th b")).toHaveText(["A note you wrote", "Secure note", "Locked note"]);
  const cell = (row: number, col: number) => matrix.locator("tbody tr").nth(row).locator("td").nth(col);
  await expect(cell(0, 0)).toHaveText("Reads it. Rewrites it only if you allow it");
  await expect(cell(0, 2)).toContainText("Never your words");
  await expect(cell(1, 0)).toContainText("unless you turn that off");
  await expect(cell(1, 1)).toHaveText("Never sees it, not even the title");
  await expect(cell(1, 2)).toHaveText("Leaves it alone");
  await expect(cell(2, 0)).toHaveText("Reads it. Never changes it");
  await expect(cell(2, 1)).toHaveText("Reads it. Never changes it");
  await expect(cell(2, 2)).toHaveText("Leaves it alone");

  const points = page.locator(".promise-points > li strong");
  await expect(points).toHaveText([
    "Secure notes.",
    "Locked notes.",
    "Notes you write.",
    "The Librarian.",
    "Everything else.",
  ]);
  const list = page.locator(".promise-points");
  await expect(list).toContainText("Let AI edit the text");
  await expect(list).toContainText("never changes your words");
  await expect(list).toContainText("skips secure and locked notes");
  await expect(list).toContainText("no account and no analytics");
  await expect(page.locator(".promise-note")).toContainText("not encryption");
});

// 660: four columns in the narrowest reading column that still shows them.
for (const width of [320, 390, 660, 768, 1024, 1440, 1920, 2560]) {
  test(`the promise's matrix reads at ${width}px with nothing off the side`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/privacy/#promise");
    const matrix = page.locator(".promise-matrix");
    await matrix.scrollIntoViewIfNeeded();
    const fits = await matrix.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
    const box = (await matrix.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    if (width > 900) {
      // Beside the rail, never under it, and never narrower than the words above it.
      const rail = (await page.locator("[data-article-rail]").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width);
      const lede = (await page.locator(".promise-lede").boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(lede.width - 1);
    }

    const cells = page.locator(".promise-matrix tbody td");
    await expect(cells).toHaveCount(9);
    const phone = width <= 640;
    // On a phone the column heads step aside and every cell names its reader.
    const labels = await cells.evaluateAll((items) =>
      items.map((item) => getComputedStyle(item, "::before").content.replace(/"/g, "")),
    );
    if (phone) {
      expect(labels).toEqual([...READERS, ...READERS, ...READERS]);
      // A cell's label and its words sit side by side, never on top of each other.
      const first = await cells.first().evaluate((td) => {
        const r = td.getBoundingClientRect();
        return { width: r.width };
      });
      expect(first.width).toBeGreaterThan(width * 0.75);
    } else {
      expect(labels.every((l) => l === "none" || l === "normal" || l === "")).toBe(true);
      await expect(page.locator(".promise-matrix thead")).toBeVisible();
    }
    // No two cells' boxes overlap.
    const rects = await cells.evaluateAll((items) => items.map((i) => i.getBoundingClientRect().toJSON()));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        expect(overlap, `cells ${i} and ${j} overlap at ${width}`).toBe(false);
      }
  });
}
