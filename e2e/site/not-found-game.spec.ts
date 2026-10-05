// The 404 game: nothing moves until Play; Space (or a tap) jumps; Escape pauses; a fall
// shows the distance and Play again; "Take me home" stays a working link throughout.
import { expect, test } from "@playwright/test";

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
