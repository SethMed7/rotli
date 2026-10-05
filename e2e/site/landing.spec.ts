// The landing page: where rotli runs (Mac first, Windows and Linux planned), the cardless
// before/after, and the privacy passage that takes the whole page, header included, into
// Ocean Dark and back out in either direction.
import { expect, test, type Page } from "@playwright/test";

const passage = (page: Page) => page.evaluate(() => document.documentElement.dataset.passage ?? "");
const scrollToPrivacy = (page: Page, share: number) =>
  page.evaluate((s) => {
    const band = document.getElementById("privacy")!;
    const top = band.getBoundingClientRect().top + window.scrollY;
    // The page scrolls smoothly by default; jump, so each step lands before it is checked.
    window.scrollTo({ top: top + band.offsetHeight * s - window.innerHeight / 2, behavior: "instant" });
  }, share);

test("the hero promises a workspace for notes and says the Mac comes first", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".hero");
  await expect(hero.locator(".hero-lede")).toContainText("a private workspace for your notes");
  await expect(hero.locator(".hero-lede")).not.toContainText("for your Mac");
  await expect(hero.locator(".hero-platforms")).toHaveText(
    /^Mac first.*Windows and Linux apps are planned\.$/,
  );
});

test("the download page calls Windows and Linux planned, not available", async ({ page }) => {
  await page.goto("/download/");
  for (const name of ["Windows", "Linux"]) {
    const row = page.locator(".all li", { has: page.getByRole("heading", { name, exact: true }) });
    await expect(row.locator(".status")).toHaveText("Planned");
  }
});

test("the before and after are open columns: the same words, with added lines marked", async ({ page }) => {
  await page.goto("/");
  const pair = page.locator(".pair");
  await expect(pair.locator(".paper")).toHaveCount(0);
  const bodies = pair.locator(".body");
  await expect(bodies).toHaveCount(2);
  expect(await bodies.nth(0).textContent()).toBe(await bodies.nth(1).textContent());
  await expect(pair.locator(".added .row")).toHaveCount(6);
  await expect(pair.locator(".added")).toContainText("area: Clients");
  await expect(pair.locator(".added")).not.toContainText("Clients/");
});

test("the page passes into the privacy night and back out, either way", async ({ page }) => {
  await page.goto("/");
  const header = page.locator(".site-header-bar");
  const themeColor = page.locator('meta[name="theme-color"]');
  expect(await passage(page)).toBe("");

  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  await expect(themeColor).toHaveAttribute("content", "#0e171d");
  await expect(header).toHaveCSS("background-color", "rgb(14, 23, 29)");

  // Out through the top: the page above it is light again.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => passage(page)).toBe("");
  await expect(themeColor).toHaveAttribute("content", "#f8f2e9");
  await expect(header).toHaveCSS("background-color", "rgb(248, 242, 233)");

  // In again, and out through the bottom.
  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  await scrollToPrivacy(page, 1.6);
  await expect.poll(() => passage(page)).toBe("");
});

test("a reload in the middle of the privacy band lands in the night at once", async ({ page }) => {
  await page.goto("/");
  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  await page.reload();
  await expect.poll(() => passage(page)).toBe("ocean-dark");
});

test("the theme studio's steps sit on one row at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const steps = page.locator(".studio-steps");
  await steps.scrollIntoViewIfNeeded();
  const [previous, label, next] = await Promise.all([
    steps.getByRole("button", { name: "Previous theme" }).boundingBox(),
    steps.locator(".carousel-label").boundingBox(),
    steps.getByRole("button", { name: "Next theme" }).boundingBox(),
  ]);
  expect(previous && label && next).toBeTruthy();
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  expect(Math.abs(middle(previous!) - middle(next!))).toBeLessThan(2);
  expect(Math.abs(middle(previous!) - middle(label!))).toBeLessThan(12);
  expect(previous!.x).toBeLessThan(label!.x);
  expect(label!.x).toBeLessThan(next!.x);
});

test("the landing says rotli is more than notes and asks no extra AI fee", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".overview .section-lede")).toContainText("Notes are the foundation.");
  await expect(page.locator("#waiting .close")).toContainText("no extra AI plan to buy");
  const faq = page.locator(".faq-list summary");
  await expect(faq.filter({ hasText: "Do I have to pay for AI?" })).toHaveCount(1);
  await expect(faq.filter({ hasText: "Is rotli just a notes app?" })).toHaveCount(1);
});

test("the page, its header, and its buttons cross into the night on one clock", async ({ page }) => {
  await page.goto("/");
  await scrollToPrivacy(page, 0.1);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  // Freeze the crossfade a third of the way in: the header is the page's own ground, and the
  // night band's feathered edge is there to meet it.
  const colours = await page.evaluate(() => {
    const root = document.documentElement;
    for (const animation of document.getAnimations()) {
      if (animation.effect instanceof KeyframeEffect && animation.effect.target === root) {
        animation.pause();
        animation.currentTime = 300;
      }
    }
    const header = getComputedStyle(document.querySelector(".site-header-bar")!).backgroundColor;
    const body = getComputedStyle(document.body).backgroundColor;
    const feather = getComputedStyle(document.getElementById("privacy")!, "::before").backgroundImage;
    return { header, body, feather };
  });
  expect(colours.header).toBe(colours.body);
  expect(colours.header).not.toBe("rgb(248, 242, 233)");
  expect(colours.header).not.toBe("rgb(14, 23, 29)");
  expect(colours.feather).toContain("linear-gradient");
});

test("under reduced motion the page switches to the night at once", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await scrollToPrivacy(page, 0.5);
  await expect.poll(() => passage(page)).toBe("ocean-dark");
  // No transition on the root: the very next frame is already the night.
  const state = await page.evaluate(() => ({
    running: document
      .getAnimations()
      .filter((a) => a.effect instanceof KeyframeEffect && a.effect.target === document.documentElement)
      .length,
    header: getComputedStyle(document.querySelector(".site-header-bar")!).backgroundColor,
  }));
  expect(state).toEqual({ running: 0, header: "rgb(14, 23, 29)" });
  await context.close();
});

test("the bench's AI tools are named, and no two names touch at any width", async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const names = page.locator(".bench-scene .bot-name");
    await expect(names).toHaveText(["ChatGPT", "Claude", "Gemini", "Grok"]);
    const boxes = await names.evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().toJSON()),
    );
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].left).toBeGreaterThan(boxes[i - 1].right + 2);
    const scene = await page.locator(".bench-scene").evaluate((el) => el.getBoundingClientRect().toJSON());
    for (const box of boxes) expect(box.right).toBeLessThanOrEqual(scene.right);
  }
});
