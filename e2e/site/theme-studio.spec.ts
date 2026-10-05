// The theme studio ("Make it yours"): it steps through the environments on its own once it is
// on screen, a hovered swatch shows at once and holds it, leaving lets it go on, a click pins
// it, and reduced motion never plays it. The clock is Playwright's, so no test waits 3 s a step.
import { expect, test, type Page } from "@playwright/test";

const caption = (page: Page) => page.locator("#theme-environment");

async function toStudio(page: Page) {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".studio").scrollIntoViewIfNeeded();
  await expect(page.locator(".studio")).toHaveAttribute("data-cycle", "auto");
}

test("on arrival it goes through the environments on its own", async ({ page }) => {
  await toStudio(page);
  await expect(caption(page)).toHaveText("Warm Light");
  await page.clock.runFor(3300);
  await expect(caption(page)).toHaveText("Warm Dark");
  await page.clock.runFor(3300);
  await expect(caption(page)).toHaveText("Paper");
  // Steps it takes on its own are not announced.
  await expect(page.locator(".carousel-label")).toHaveAttribute("aria-live", "off");
});

test("hovering a swatch shows it at once and holds; leaving carries on from there", async ({ page }) => {
  await toStudio(page);
  await page.getByRole("button", { name: "Grove Dark" }).hover();
  await expect(caption(page)).toHaveText("Grove Dark");
  await expect(page.getByRole("button", { name: "Grove Dark" })).toHaveAttribute("aria-pressed", "true");
  await page.clock.runFor(12_000);
  await expect(caption(page)).toHaveText("Grove Dark");
  await page.mouse.move(10, 10);
  await page.clock.runFor(2600);
  await expect(caption(page)).toHaveText("Iris Light");
});

test("a click pins the choice; a hover then only previews", async ({ page }) => {
  await toStudio(page);
  await page.getByRole("button", { name: "Ocean Dark" }).click();
  await expect(page.locator(".studio")).toHaveAttribute("data-cycle", "pinned");
  await page.getByRole("button", { name: "Blossom Light" }).hover();
  await expect(caption(page)).toHaveText("Blossom Light");
  await page.mouse.move(10, 10);
  await expect(caption(page)).toHaveText("Ocean Dark");
  await page.clock.runFor(20_000);
  await expect(caption(page)).toHaveText("Ocean Dark");
});

test("the keyboard reaches every swatch, and focus holds the cycle", async ({ page }) => {
  await toStudio(page);
  await page.getByRole("button", { name: "Midnight Light" }).focus();
  await expect(caption(page)).toHaveText("Midnight Light");
  await page.keyboard.press("Shift+Tab");
  await expect(caption(page)).toHaveText("Blossom Dark");
  await page.keyboard.press("Enter");
  await expect(page.locator(".studio")).toHaveAttribute("data-cycle", "pinned");
});

test("on a phone it plays too, and previous and next take over", async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".studio").scrollIntoViewIfNeeded();
  await expect(page.locator(".studio")).toHaveAttribute("data-cycle", "auto");
  await page.clock.runFor(3300);
  await expect(page.locator("#theme-name")).toHaveText("Rotli · Warm Dark");
  await page.getByRole("button", { name: "Next theme" }).click();
  await expect(page.locator("#theme-name")).toHaveText("Paper & Charcoal · Paper");
  await expect(page.locator(".carousel-label")).toHaveAttribute("aria-live", "polite");
  await page.clock.runFor(20_000);
  await expect(page.locator("#theme-name")).toHaveText("Paper & Charcoal · Paper");
});

test("under reduced motion it never plays, but a swatch still shows its environment", async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto("/");
  await page.locator(".studio").scrollIntoViewIfNeeded();
  await expect(page.locator(".studio")).toHaveAttribute("data-cycle", "off");
  await page.clock.runFor(20_000);
  await expect(caption(page)).toHaveText("Warm Light");
  await page.getByRole("button", { name: "Iris Dark" }).hover();
  await expect(caption(page)).toHaveText("Iris Dark");
  await context.close();
});
