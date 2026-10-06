// The footer's quokka scene: residents doing their own things; the visitor's person, brought in
// by the mouse and sent by clicks, a finger, or the arrow keys (over the beach, or from "Walk
// on the beach") to the leaf pile, to a quokka to feed it, and to the game of catch, where a
// click on a quokka throws it the ball; a ring under what a click would act on; a leaf still
// carried by hand from the pile to a quokka or dropped on the sand; and a scene that never
// moves on its own under reduced motion, where the person steps straight to where it is sent.
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

const status = (page: Page) => page.locator("[data-feed-status]");
const person = (page: Page) => page.locator("[data-person]");
const centreX = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).boundingBox())!;
  return box.x + box.width / 2;
};
const sandY = async (page: Page) => {
  const scene = (await page.locator("[data-scenery]").boundingBox())!;
  return scene.y + scene.height * 0.75;
};

const centreOf = async (page: Page, selector: string) => {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const personX = async (page: Page) => {
  const box = (await person(page).boundingBox())!;
  return box.x + box.width / 2;
};

test("the mouse brings a person onto the beach; a click on the leaves, then on a quokka, feeds it", async ({
  page,
}) => {
  await toFooter(page);
  const y = await sandY(page);
  await expect(person(page)).not.toHaveClass(/is-here/);
  // Coming onto the sand brings the person in; passing over the pile does nothing more.
  await page.mouse.move(await centreX(page, "[data-food]"), y, { steps: 4 });
  await expect(person(page)).toHaveClass(/is-here/);
  await page.waitForTimeout(800);
  await expect(status(page)).not.toHaveText("You picked up a leaf.");
  const food = await centreOf(page, "[data-food]");
  await page.mouse.click(food.x, food.y);
  await expect(status(page)).toHaveText("You picked up a leaf.", { timeout: 8000 });
  await expect(person(page).locator("[data-person-leaf]")).not.toHaveAttribute("visibility", "hidden");
  const sitter = await centreOf(page, '[data-quokka="sitter"]');
  await page.mouse.click(sitter.x, sitter.y);
  await expect(status(page)).toHaveText("The quokka sitting by the pile took the leaf.", { timeout: 8000 });
  await expect(page.locator('[data-quokka="guard"]')).toHaveAttribute("data-mood", "happy");
  await expect(page.locator("[data-pop]")).toHaveClass(/is-popping/);
  // It stands beside the quokka it fed, never on top of it.
  const [them, us] = await Promise.all([
    page.locator('[data-quokka="sitter"]').boundingBox(),
    person(page).boundingBox(),
  ]);
  const gap = Math.abs(them!.x + them!.width / 2 - (us!.x + us!.width / 2));
  expect(gap).toBeGreaterThan(them!.width / 2);
});

test("a click on the ball joins the catch; then a click on a quokka throws it there, and it comes back", async ({
  page,
}) => {
  await toFooter(page);
  const ball = await centreOf(page, "[data-ball]");
  await page.mouse.move(ball.x, ball.y, { steps: 4 });
  await page.mouse.click(ball.x, ball.y);
  await expect(status(page)).toHaveText("You caught the ball.", { timeout: 10_000 });
  const guard = await centreOf(page, '[data-quokka="guard"]');
  await page.mouse.click(guard.x, guard.y);
  await expect(status(page)).toHaveText("You threw the ball to the quokka minding the pile.");
  await expect(status(page)).toHaveText("You caught the ball.", { timeout: 10_000 });
});

test("what a click would act on shows a pointer and a ring on the sand", async ({ page }) => {
  await toFooter(page);
  const scene = page.locator("[data-scenery]");
  const sitter = await centreOf(page, '[data-quokka="sitter"]');
  await page.mouse.move(sitter.x, sitter.y, { steps: 3 });
  await expect(scene).toHaveAttribute("data-hover", "quokka");
  await expect(scene).toHaveCSS("cursor", "pointer");
  await expect(page.locator("[data-target-mark]")).toHaveClass(/is-on/);
  // Open sky over the sand between the pile and the guard: nothing to act on.
  const food = (await page.locator("[data-food]").boundingBox())!;
  const box = (await scene.boundingBox())!;
  await page.mouse.move(food.x + food.width + 40, box.y + 12, { steps: 3 });
  await expect(scene).not.toHaveAttribute("data-hover");
  await expect(page.locator("[data-target-mark]")).not.toHaveClass(/is-on/);
});

test("with the mouse over the beach the arrow keys walk the person; elsewhere they are the page's", async ({
  page,
}) => {
  await toFooter(page);
  const y = await sandY(page);
  const guard = await centreOf(page, '[data-quokka="guard"]');
  await page.mouse.move(guard.x, y, { steps: 4 });
  await expect(person(page)).toHaveClass(/is-here/);
  await page.waitForTimeout(1200); // it has walked in and stopped
  const before = await personX(page);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowLeft");
  await expect.poll(() => personX(page)).toBeLessThan(before - 40);
  // The pointer off the beach: the keys are the page's again.
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  const still = await personX(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(300);
  expect(Math.abs((await personX(page)) - still)).toBeLessThan(2);
  // Typing in a field never walks the person, even with the pointer over the beach.
  const field = page.locator(".site-footer input").first();
  if ((await field.count()) > 0) {
    await field.focus();
    await page.mouse.move(guard.x, y, { steps: 2 });
    await page.waitForTimeout(300);
    const typed = await personX(page);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(300);
    expect(Math.abs((await personX(page)) - typed)).toBeLessThan(2);
  }
});

test("from the keyboard, Walk on the beach takes the arrow keys", async ({ page }) => {
  await toFooter(page);
  const walk = page.getByRole("button", { name: "Walk on the beach" });
  await walk.focus();
  await expect(walk).toBeVisible();
  await expect(person(page)).toHaveClass(/is-here/);
  const food = (await page.locator("[data-food]").boundingBox())!;
  // Hold ← until the person comes up to the pile, then let go: it stops at it.
  await page.keyboard.down("ArrowLeft");
  await expect
    .poll(
      async () => {
        const box = (await person(page).boundingBox())!;
        return box.x + box.width / 2 < food.x + food.width + 30;
      },
      { intervals: [25] },
    )
    .toBe(true);
  await page.keyboard.up("ArrowLeft");
  await expect(status(page)).toHaveText("You picked up a leaf.", { timeout: 8000 });
  const guard = (await page.locator('[data-quokka="guard"]').boundingBox())!;
  await page.keyboard.down("ArrowRight");
  await expect
    .poll(
      async () => {
        const box = (await person(page).boundingBox())!;
        return box.x + box.width / 2 > guard.x - 30;
      },
      { intervals: [25] },
    )
    .toBe(true);
  await page.keyboard.up("ArrowRight");
  await expect(status(page)).toHaveText("The quokka minding the pile took the leaf.", { timeout: 8000 });
});

test("on a phone a tap sends the person: to the leaves, then to a quokka", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await toFooter(page);
  const y = await sandY(page);
  await page.touchscreen.tap(await centreX(page, "[data-food]"), y);
  await expect(person(page)).toHaveClass(/is-here/);
  await expect(status(page)).toHaveText("You picked up a leaf.", { timeout: 8000 });
  await page.touchscreen.tap(await centreX(page, '[data-quokka="guard"]'), y);
  await expect(status(page)).toHaveText("The quokka minding the pile took the leaf.", { timeout: 8000 });
  await context.close();
});

test("under reduced motion nothing moves on its own, and the person steps straight there", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/about/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scene = page.locator("[data-scenery]");
  await expect(scene).toBeVisible();
  // At rest until the visitor plays: no loop, no stroll, the ball in a player's paws.
  await page.waitForTimeout(600);
  await expect(scene).not.toHaveClass(/is-live/);
  await expect(page.getByRole("button", { name: "Walk on the beach" })).toBeAttached();
  // The page moves after the scene started listening: its resting boxes must not go stale.
  await page.evaluate(() => window.scrollBy({ top: -30, behavior: "instant" }));
  const y = await sandY(page);
  const foodX = await centreX(page, "[data-food]");
  await page.mouse.move(foodX, y);
  await expect(person(page)).toHaveClass(/is-here/);
  // No walk: it is already standing where the mouse came in.
  const box = (await person(page).boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - foodX)).toBeLessThan(6);
  // The page was scrolled up a little, so the band's bottom edge is under the window's: click
  // the top of the pile and the middle of the guard, both in view.
  const food = (await page.locator("[data-food]").boundingBox())!;
  await page.mouse.click(foodX, food.y + 8);
  await expect(status(page)).toHaveText("You picked up a leaf.");
  const guard = await centreOf(page, '[data-quokka="guard"]');
  await page.mouse.click(guard.x, guard.y - 10);
  await expect(status(page)).toHaveText("The quokka minding the pile took the leaf.");
  // The stroller never set off.
  await expect(page.locator('[data-quokka="walker"]')).not.toHaveAttribute("style", /translateX\((?!-?\d)/);
  await context.close();
});
