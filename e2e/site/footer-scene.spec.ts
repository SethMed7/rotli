// The footer's quokka scene: residents doing their own things, a leaf carried from the pile
// to a quokka (mouse or touch) or dropped on the sand, the same from the keyboard, and a
// scene that stands still under reduced motion.
import { expect, test, type Page } from "@playwright/test";

async function toFooter(page: Page) {
  await page.goto("/about/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator("[data-scenery]")).toHaveClass(/is-live/);
}

async function carry(page: Page, to: { x: number; y: number }) {
  const food = (await page.locator("[data-food]").boundingBox())!;
  await page.mouse.move(food.x + food.width / 2, food.y + food.height / 2);
  await page.mouse.down();
  await expect(page.locator("[data-scenery]")).toHaveClass(/is-carrying/);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test("every resident has its own pose", async ({ page }) => {
  await toFooter(page);
  await expect(page.locator('[data-quokka="sitter"]')).toHaveAttribute("data-pose-kind", "listening");
  await expect(page.locator('[data-quokka="nibbler"]')).toHaveAttribute("data-pose-kind", "thoughtful");
  await expect(page.locator('[data-quokka="walker"]')).toHaveAttribute("data-pose-kind", "walking");
  await expect(page.locator('[data-quokka="player-a"] [data-pose="cheer"]')).toHaveCount(1);
  await expect(page.locator('[data-quokka="guard"] [data-pose="wave"]')).toHaveCount(1);
  // The old reaching arm is gone.
  await expect(page.locator(".qk-arm")).toHaveCount(0);
});

test("a leaf carried from the pile to a quokka is handed over, and the guard is pleased", async ({
  page,
}) => {
  await toFooter(page);
  const sitter = (await page.locator('[data-quokka="sitter"]').boundingBox())!;
  await carry(page, { x: sitter.x + sitter.width / 2, y: sitter.y + sitter.height / 2 });
  await expect(page.locator("[data-feed-status]")).toHaveText(
    "The quokka sitting by the pile took the leaf.",
  );
  await expect(page.locator('[data-quokka="guard"]')).toHaveAttribute("data-mood", "happy");
});

test("a leaf let go over open sand falls, and the guard is sad", async ({ page }) => {
  await toFooter(page);
  const scene = (await page.locator("[data-scenery]").boundingBox())!;
  const food = (await page.locator("[data-food]").boundingBox())!;
  // Open sky between the pile and the guard: no quokka there.
  await carry(page, { x: food.x + food.width + 40, y: scene.y + 20 });
  await expect(page.locator("[data-feed-status]")).toHaveText("The leaf fell on the sand.");
  await expect(page.locator('[data-quokka="guard"]')).toHaveAttribute("data-mood", "sad", { timeout: 8000 });
});

test("the keyboard hands a leaf over with the button before the scene", async ({ page }) => {
  await toFooter(page);
  const button = page.getByRole("button", { name: "Hand the quokkas a leaf" });
  await button.focus();
  await expect(button).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-feed-status]")).toHaveText(/took the leaf\.$/);
});

test("on a phone a finger drags a leaf too", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await toFooter(page);
  const food = (await page.locator("[data-food]").boundingBox())!;
  const guard = (await page.locator('[data-quokka="guard"]').boundingBox())!;
  // Real touch input (Chromium turns it into pointer events), not synthetic pointer events.
  const cdp = await context.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const from = { x: food.x + food.width / 2, y: food.y + food.height / 2 };
  const to = { x: guard.x + guard.width / 2, y: guard.y + guard.height / 2 };
  await touch("touchStart", from.x, from.y);
  await expect(page.locator("[data-scenery]")).toHaveClass(/is-carrying/);
  for (let k = 1; k <= 8; k++)
    await touch("touchMove", from.x + ((to.x - from.x) * k) / 8, from.y + ((to.y - from.y) * k) / 8);
  await touch("touchEnd", to.x, to.y);
  await expect(page.locator("[data-feed-status]")).toHaveText("The quokka minding the pile took the leaf.");
  await context.close();
});

test("under reduced motion the scene stands still and offers no play button", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/about/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator("[data-scenery]")).toBeVisible();
  await expect(page.locator("[data-scenery]")).not.toHaveClass(/is-live/);
  await expect(page.getByRole("button", { name: "Hand the quokkas a leaf" })).toBeHidden();
  await context.close();
});
