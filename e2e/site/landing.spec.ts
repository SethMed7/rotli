// The landing page: what rotli is, its one "Download free" and the pointer to the privacy promise (where it runs is
// /download/'s to say), the cardless
// before/after, the close after the questions, and the privacy passage that takes the whole page, header included, into
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

test("the hero says what rotli is and costs, with one way in, and no platform line", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".hero");
  const lede = hero.locator(".hero-lede");
  await expect(lede).toContainText("a free workspace built on plain Markdown files");
  await expect(lede).toContainText("Docs and Sheets (beta)");
  await expect(lede).not.toContainText("Mac");
  await expect(hero.locator(".hero-cost")).toHaveText("No account. Works offline.");
  // Where rotli runs is the download page's (and the FAQ's) to say (the owner, 2026-10-05).
  await expect(hero).not.toContainText("Windows");
  await expect(page.locator("#start")).not.toContainText("Windows");
  // One way in, "Download free", to the page that offers the Mac app and Rotli Web; no direct
  // DMG. The header keeps its shorter "Try now" to the same page.
  const actions = hero.locator(".site-actions a");
  await expect(actions).toHaveCount(1);
  await expect(actions).toHaveText("Download free");
  await expect(actions).toHaveAttribute("href", "/download/");
  await expect(page.locator("main a[href$='.dmg']")).toHaveCount(0);
  const header = page.locator(".site-header .header-download");
  await expect(header).toHaveText("Try now");
  await expect(header).toHaveAttribute("href", "/download/");
});

test("the hero points to the privacy promise, and the night band points to the same place", async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const promise = page.locator(".hero .hero-promise a");
    await expect(promise).toBeVisible();
    await expect(promise).toHaveText(/Our privacy promise: you decide what any AI can see or change/);
    await expect(promise).toHaveAttribute("href", "/privacy/#promise");
    // Under the button, inside the first window, and a full touch target.
    const [button, link] = await Promise.all([
      page.locator(".hero .site-actions a").boundingBox(),
      promise.boundingBox(),
    ]);
    expect(link!.y).toBeGreaterThan(button!.y + button!.height);
    expect(link!.y + link!.height).toBeLessThanOrEqual(900);
    expect(link!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator("#privacy .privacy-link")).toHaveAttribute("href", "/privacy/#promise");
  // Following it lands on the promise, under the header.
  await page.locator(".hero .hero-promise a").click();
  await expect(page).toHaveURL(/\/privacy\/#promise$/);
  await expect(page.locator("#promise")).toBeInViewport();
});

test("Rotli Web lives in the tour, and the page closes on one banner after the questions", async ({
  page,
}) => {
  await page.goto("/");
  // The ways-in chapter folded into the tour (2026-10-05); its item renders only while
  // WEB_APP_ENABLED, and this suite's build may leave it off.
  await expect(page.locator("#web-title")).toHaveCount(0);
  const web = page.locator("#tour-button-web");
  if ((await web.count()) > 0) await expect(web).toContainText("Rotli Web and the Helper");
  await expect(page.locator("#final-title")).toHaveCount(0);
  const sections = page.locator("main > section");
  await expect(sections.last()).toHaveId("start");
  await expect(sections.nth((await sections.count()) - 2)).toHaveId("faq");
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

test("the figures lead the band, each with its population and its source", async ({ page }) => {
  await page.goto("/");
  const figures = page.locator("#waiting .figures li");
  await expect(figures.locator(".value")).toHaveText([/^50\.4%/, /^Half/, /^3\.0/, /^59\.9%/]);
  await expect(figures.nth(0)).toContainText("paying for ChatGPT");
  await expect(figures.nth(1)).toContainText("pay for AI");
  await expect(figures.nth(2)).toContainText("average AI user");
  await expect(figures.nth(3)).toContainText("of any kind");
  // Footnotes are per source: Self Financial (1) and Menlo (2).
  const marks = await figures
    .locator("sup a")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  expect(marks).toEqual(["#fn-1", "#fn-2", "#fn-2", "#fn-1"]);
  await expect(page.locator("#fn-1")).toContainText("Self Financial");
  await expect(page.locator("#fn-2")).toContainText("Menlo Ventures");
  await expect(page.locator("#waiting")).not.toContainText(/wasted/i);
});

test("the landing says rotli is more than notes and asks no extra AI fee", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".overview .section-lede")).toContainText("Everything starts as a Markdown file");
  await expect(page.locator("#waiting .close")).toContainText("no extra AI plan to buy");
  await expect(page.locator("#waiting .study a")).toHaveAttribute(
    "href",
    "/blog/the-ai-you-already-pay-for/",
  );
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

test("the film sits across the hand-off: the warm band begins behind it, with no strip between", async ({
  browser,
}) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ reducedMotion, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto("/");
    // Let the film's arrival finish: it rises once and rests.
    await page.locator(".hero-film").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const state = await page.evaluate(() => {
      const strip = document.querySelector(".below-fold")!;
      const film = document.querySelector(".hero-film video")!.getBoundingClientRect();
      const band = document.querySelector("#waiting")!;
      const bandTop = band.getBoundingClientRect().top;
      return {
        // The strip's ground eases from the page's into the band's.
        image: getComputedStyle(strip).backgroundImage,
        bandColour: getComputedStyle(band).backgroundColor,
        stripIsBefore: strip.nextElementSibling === band,
        gap: bandTop - film.bottom,
        // Nothing about the film is tied to the scroll.
        scrollLinked: document
          .getAnimations()
          .some((a) => a.timeline && !(a.timeline instanceof DocumentTimeline)),
      };
    });
    expect(state.image).toContain("linear-gradient");
    expect(state.image).toContain("241, 231, 216");
    expect(state.bandColour).toBe("rgb(241, 231, 216)");
    expect(state.stripIsBefore).toBe(true);
    expect(state.gap).toBeGreaterThanOrEqual(0);
    expect(state.gap).toBeLessThan(8);
    expect(state.scrollLinked).toBe(false);
    if (reducedMotion === "reduce") {
      const running = await page.locator(".hero-film").evaluate((el) => el.getAnimations().length);
      expect(running).toBe(0);
    }
    await context.close();
  }
});
