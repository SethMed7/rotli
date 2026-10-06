// /features/ as a catalog (site/src/features.ts): every capability a tile grouped by area, a
// search box and area chips that filter in place and live in the address, a page per
// capability that can be linked straight to, keyboard use, the plain grouped list without
// script, and one column on a phone. This suite's build has WEB_APP_ENABLED off, so the Rotli
// Web tiles are absent; nothing here assumes them.
import { expect, test } from "@playwright/test";

const tiles = (page: import("@playwright/test").Page) => page.locator("[data-feature]");
const visibleTiles = (page: import("@playwright/test").Page) => page.locator("[data-feature]:visible");

test("every capability is a tile that links to its own page, grouped by area", async ({ page }) => {
  await page.goto("/features/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everything rotli does, in plain files.");
  const count = await tiles(page).count();
  expect(count).toBeGreaterThan(20);
  for (const tile of await tiles(page).all()) {
    const id = await tile.getAttribute("data-feature");
    await expect(tile.locator("a")).toHaveAttribute("href", `/features/${id}/`);
    await expect(tile.locator(".status")).toHaveText(/^(Shipped|Beta|Coming soon)$/);
  }
  await expect(page.locator(".area h2")).toHaveText([
    "Writing",
    "Organizing",
    "AI and chat",
    "Files",
    "Privacy and control",
    "Rotli Web and agents",
  ]);
  // Docs and Sheets say Beta; the next release's items say Coming soon.
  await expect(page.locator('[data-feature="docs"] .status')).toHaveText("Beta");
  await expect(page.locator('[data-feature="charts"] .status')).toHaveText("Coming soon");
  await expect(page.locator('[data-feature="rotli-web"]')).toHaveCount(0);
  await expect(page.locator("[data-catalog-count]")).toHaveText(`${count} features`);
});

test("an area chip filters the catalog and stays in the address", async ({ page }) => {
  await page.goto("/features/");
  const all = await tiles(page).count();
  const chip = page.getByRole("button", { name: "AI and chat" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveURL(/\?area=ai$/);
  const shown = await visibleTiles(page).count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(all);
  for (const tile of await visibleTiles(page).all()) await expect(tile).toHaveAttribute("data-area", "ai");
  await expect(page.locator("#writing")).toBeHidden();
  await expect(page.locator("[data-catalog-count]")).toHaveText(`${shown} features in AI and chat`);
  // The pressed chip again shows everything.
  await chip.click();
  await expect(visibleTiles(page)).toHaveCount(all);
  await expect(page).toHaveURL(/\/features\/$/);
});

test("search narrows the catalog, and says so when nothing matches", async ({ page }) => {
  await page.goto("/features/");
  const all = await tiles(page).count();
  const search = page.getByRole("searchbox", { name: "Search features" });
  await search.fill("excalidraw");
  await expect(visibleTiles(page)).toHaveCount(1);
  await expect(visibleTiles(page)).toHaveAttribute("data-feature", "boards");
  await expect(page).toHaveURL(/\?q=excalidraw$/);
  await search.fill("zzzz nothing");
  await expect(visibleTiles(page)).toHaveCount(0);
  await expect(page.locator("[data-catalog-empty]")).toBeVisible();
  await page.getByRole("button", { name: "Show every feature" }).click();
  await expect(visibleTiles(page)).toHaveCount(all);
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  // Escape clears the box too.
  await search.fill("chat");
  await search.press("Escape");
  await expect(visibleTiles(page)).toHaveCount(all);
});

test("a filtered catalog can be linked, and Back from a feature returns to it", async ({ page }) => {
  await page.goto("/features/?area=files");
  await expect(page.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true");
  for (const tile of await visibleTiles(page).all()) await expect(tile).toHaveAttribute("data-area", "files");
  await page.locator('[data-feature="boards"] a').click();
  await expect(page).toHaveURL(/\/features\/boards\/$/);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#writing")).toBeHidden();
});

test("a feature's page stands on its own: status, picture, how to use it, and the rest of its area", async ({
  page,
}) => {
  await page.goto("/features/boards/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Boards");
  await expect(page.locator(".crumbs a")).toHaveText(["Features", "Files"]);
  await expect(page.locator(".crumbs a").nth(1)).toHaveAttribute("href", "/features/?area=files#files");
  await expect(page.locator(".head .status")).toHaveText("Shipped");
  await expect(page.locator(".head .meta")).toContainText("Mac app");
  await expect(page.getByRole("img", { name: /Excalidraw board/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it does" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How to use it" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "More in Files" })).toBeVisible();
  await expect(page.locator(".rest [data-feature]")).not.toHaveCount(0);
  await expect(page.locator('.rest [data-feature="boards"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/features\/boards\/$/);
  // Something not out yet says so, and doesn't claim where it runs.
  await page.goto("/features/charts/");
  await expect(page.locator(".head .status")).toHaveText("Coming soon");
  await expect(page.locator(".head .meta")).not.toContainText("Mac");
  await expect(page.getByRole("heading", { name: "How it will work" })).toBeVisible();
});

test("the catalog works from the keyboard", async ({ page }) => {
  await page.goto("/features/");
  const chip = page.getByRole("button", { name: "Organizing" });
  await chip.focus();
  await page.keyboard.press("Space");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  const link = page.locator('[data-feature="librarian"] a');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/features\/librarian\/$/);
});

test.describe("without script", () => {
  test.use({ javaScriptEnabled: false });

  test("the catalog is the complete grouped list, with jump links instead of filters", async ({ page }) => {
    await page.goto("/features/");
    await expect(page.locator("[data-catalog-tools]")).toBeHidden();
    await expect(page.locator(".jump a")).toHaveCount(6);
    await expect(page.locator(".jump a").first()).toHaveAttribute("href", "#writing");
    const all = await tiles(page).count();
    await expect(visibleTiles(page)).toHaveCount(all);
    await page.locator('[data-feature="chat"] a').click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chat with your notes");
  });
});

test("on a phone the tiles are one column and the chips wrap inside the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/features/");
  const lefts = await page
    .locator("#writing [data-feature]")
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (const chip of await page.locator("[data-chip]").all()) {
    const box = (await chip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
