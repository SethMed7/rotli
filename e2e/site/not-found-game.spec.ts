// The 404 page: a headline, "Take me home", and two quiet links, nothing Mac-specific. Its
// game: nothing moves until Play; Space (or a tap) jumps; ↓ (or a press on the sand) ducks
// while held; the level shows during a run; Escape pauses; a fall shows the distance and
// Play again; "Take me home" stays a working link throughout, and the taller stage still
// fits a laptop's window with the words above it.
import { expect, test } from "@playwright/test";

test("the words are few: the headline, the way home, and two quiet links", async ({ page }) => {
  await page.goto("/no-such-page/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This note wandered off.");
  await expect(page.getByRole("link", { name: "Take me home" })).toHaveAttribute("href", "/");
  const also = page.locator(".also a");
  await expect(also).toHaveText(["Try rotli", "Resources"]);
  await expect(also.first()).toHaveAttribute("href", "/download/");
  const lost = page.locator(".lost");
  await expect(lost).not.toContainText("Mac");
  await expect(lost).not.toContainText("The page you followed");
  await expect(lost).not.toContainText("/no-such-page/");
  await expect(page.locator("#runner-help")).toContainText("Space or ↑ to jump, ↓ to duck.");
});

test("the taller game and the way home both fit a laptop's window", async ({ page }) => {
  const laptops: [number, number][] = [
    [1440, 900],
    [1280, 800],
  ];
  for (const [width, height] of laptops) {
    await page.setViewportSize({ width, height });
    await page.goto("/no-such-page/");
    const stage = (await page.locator("[data-runner]").boundingBox())!;
    const home = (await page.getByRole("link", { name: "Take me home" }).boundingBox())!;
    expect(stage.height, `${width}×${height}`).toBeGreaterThanOrEqual(380);
    expect(stage.y + stage.height, `${width}×${height}`).toBeLessThanOrEqual(height + 1);
    expect(home.y + home.height).toBeLessThanOrEqual(stage.y);
  }
});

test("the game waits for Play, and the way home stays usable", async ({ page }) => {
  await page.goto("/no-such-page/");
  const stage = page.locator("[data-runner]");
  await expect(stage).toHaveAttribute("data-state", "ready");
  await expect(page.getByRole("heading", { name: "Help the quokka home" })).toBeVisible();
  // Space on the home link is the link's, never the game's.
  await page.getByRole("link", { name: "Take me home" }).focus();
  await page.keyboard.press("Space");
  await expect(stage).toHaveAttribute("data-state", "ready");
  await expect(page.locator("[data-score]")).toHaveText("0");
});

test("a run scores distance, pauses on Escape, and ends in Play again", async ({ page }) => {
  await page.goto("/no-such-page/");
  const stage = page.locator("[data-runner]");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(stage).toHaveAttribute("data-state", "running");
  await expect(stage).toBeFocused();
  await page.keyboard.press("Space");
  await expect.poll(async () => Number(await page.locator("[data-score]").textContent())).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-state", "paused");
  await expect(page.getByRole("button", { name: "Keep going" })).toBeFocused();
  // While paused, the way home is one Tab away and still works.
  await expect(page.getByRole("link", { name: "Take me home" })).toHaveAttribute("href", "/");

  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(stage).toHaveAttribute("data-state", "running");
  // Without jumps the quokka trips on the first obstacle.
  await expect(stage).toHaveAttribute("data-state", "over", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Play again" })).toBeFocused();
  await expect(page.locator("[data-announce]")).toContainText("The quokka tripped after");
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(stage).toHaveAttribute("data-state", "running");
});

test("↓ ducks while held, the level shows, and ↓ elsewhere on the page is never taken", async ({ page }) => {
  await page.goto("/no-such-page/");
  const stage = page.locator("[data-runner]");
  // Before a run, ↓ on the page is the page's.
  await page.getByRole("link", { name: "Take me home" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(stage).toHaveAttribute("data-ducking", "false");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(stage).toHaveAttribute("data-state", "running");
  await expect(page.locator(".runner-level")).toBeVisible();
  await expect(page.locator("[data-level]")).toHaveText("1");
  await page.keyboard.down("ArrowDown");
  await expect(stage).toHaveAttribute("data-ducking", "true");
  await page.keyboard.up("ArrowDown");
  await expect(stage).toHaveAttribute("data-ducking", "false");
  await page.keyboard.down("s");
  await expect(stage).toHaveAttribute("data-ducking", "true");
  // Pausing lets go of the duck.
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-state", "paused");
  await expect(stage).toHaveAttribute("data-ducking", "false");
  await page.keyboard.up("s");
});

test("a press on the sand ducks until it lets go; higher up it jumps", async ({ page }) => {
  await page.goto("/no-such-page/");
  const stage = page.locator("[data-runner]");
  await page.getByRole("button", { name: "Play" }).click();
  const box = (await page.locator("[data-runner] canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.9);
  await page.mouse.down();
  await expect(stage).toHaveAttribute("data-ducking", "true");
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-ducking", "false");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.down();
  await expect(stage).toHaveAttribute("data-ducking", "false");
  await page.mouse.up();
});

test("leaving the tab pauses a run", async ({ page }) => {
  await page.goto("/no-such-page/");
  await page.getByRole("button", { name: "Play" }).click();
  const stage = page.locator("[data-runner]");
  await expect(stage).toHaveAttribute("data-state", "running");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(stage).toHaveAttribute("data-state", "paused");
});

test("a tap jumps on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/no-such-page/");
  await page.getByRole("button", { name: "Play" }).tap();
  const stage = page.locator("[data-runner]");
  await expect(stage).toHaveAttribute("data-state", "running");
  await page.locator("[data-runner] canvas").tap();
  await expect.poll(async () => Number(await page.locator("[data-score]").textContent())).toBeGreaterThan(0);
  await context.close();
});
