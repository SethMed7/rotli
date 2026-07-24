import { expect, test } from "@playwright/test";
import { centerOf, gotoApp, pointerDrag } from "./support";

test("sidebar folder menus align labels and keep explicit Trash reachable", async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 520 });
  await gotoApp(page);

  await page.getByRole("button", { name: "New folder in Main" }).click();
  await page.getByRole("textbox", { name: "New folder in Main" }).fill("Review");
  await page.getByRole("textbox", { name: "New folder in Main" }).press("Enter");
  const folder = page.locator('.main-tree [data-main-folder="1"]', { hasText: "Review" });
  await expect(folder).toBeVisible();

  await page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first().click();
  const source = page.locator(".recent-row", { hasText: "Q3 priorities — Myela" });
  await pointerDrag(page, source, await centerOf(folder));
  await expect(
    page.locator('[data-main-id="main:Review"] + *', { hasText: "Q3 priorities — Myela" }),
  ).toBeVisible();

  await folder.scrollIntoViewIfNeeded();
  await folder.click({ button: "right" });

  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /Remove from Main/ })).toBeVisible();
  const trashDrill = menu.getByRole("menuitem", {
    name: "Move folder contents to Trash…",
  });
  await expect(trashDrill).toBeVisible();
  await expect(menu.locator(".ctxmenu-check")).toHaveCount(0);

  const geometry = await menu.evaluate((element) => {
    const labels = Array.from(element.querySelectorAll<HTMLElement>(".ctxmenu-label"));
    const lefts = labels.map((label) => Math.round(label.getBoundingClientRect().left));
    const rect = element.getBoundingClientRect();
    return {
      distinctLabelColumns: new Set(lefts).size,
      bottom: rect.bottom,
      overflowY: getComputedStyle(element).overflowY,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.distinctLabelColumns).toBe(1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.overflowY).toBe("auto");

  await trashDrill.click();
  await expect(
    page.getByRole("menu").getByRole("menuitem", {
      name: /Move \d+ items? to Trash/,
    }),
  ).toBeVisible();
});
