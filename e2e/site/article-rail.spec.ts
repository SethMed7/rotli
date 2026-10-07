// A blog post's left rail (blog/ArticleRail.astro): beside the text on a wide screen with the
// title, the "On this page" tree, the reading meter as a percent, Sources, and Share (plain links,
// Copy link, Copy Markdown from the post's twin). Pinned under the header when all of it fits the
// window, held by its foot when it does not, and never clipped: no inner scroll, no fade, every
// source whole (the owner, 2026-10-06: "only show the top 4 sources then a load more if more").
// Four sources, then "Show all N sources" (a keyboard-operable button) opens the rest; without
// script all show. It stops at the end of the article, clear of "More from rotli" and the footer.
// J and K do nothing; jumps land below the header; and on a phone the tree is the disclosure, the
// meter a slim bar under the header, the sources the article's own list, and Share follows it.
import { expect, test, type Locator, type Page } from "@playwright/test";

const POST = "/blog/the-ai-you-already-pay-for/";
const URL_OF_POST = "https://rotli.co/blog/the-ai-you-already-pay-for/";

const rail = (page: Page) => page.locator("[data-article-rail]");
const percent = (page: Page, which: "rail" | "bar") =>
  page.locator(`[data-read-progress="${which}"]`).getAttribute("aria-valuenow").then(Number);

async function settled(page: Page) {
  await expect
    .poll(async () => {
      const before = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(150);
      return (await page.evaluate(() => window.scrollY)) === before;
    })
    .toBe(true);
}

const headerBottom = async (page: Page) => {
  const box = (await page.locator(".site-header-bar").boundingBox())!;
  return box.y + box.height;
};

const REM = 16;
/** Whether all of the rail fits under the header with 1.5rem above and below (the rail's rule). */
const fits = async (page: Page, height: number) =>
  (await rail(page).boundingBox())!.height <= height - (await headerBottom(page)) - 3 * REM;

const scrollToMiddle = (page: Page, offset = 0.5) =>
  page.evaluate((offset) => {
    document.documentElement.style.scrollBehavior = "auto";
    const prose = document.querySelector<HTMLElement>("[data-prose]")!;
    window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight * offset);
  }, offset);

/** Scroll the page as a reader would, a little at a time, until the box is whole between the
 * header and the window's bottom (the rail moves with the page until its head or foot shows). */
async function scrollToSee(page: Page, target: Locator) {
  const bottom = page.viewportSize()!.height;
  for (let step = 0; step < 12; step++) {
    const box = (await target.boundingBox())!;
    const above = (await headerBottom(page)) + 8 - box.y;
    const below = box.y + box.height - (bottom - 8);
    if (above <= 0 && below <= 0) return box;
    await page.evaluate(
      (by) => window.scrollBy({ top: by, behavior: "instant" }),
      above > 0 ? -above : below,
    );
  }
  return (await target.boundingBox())!;
}

/** Every element inside the rail that would clip its content (SVG icons clip by default, harmlessly). */
const clippers = (page: Page) =>
  rail(page).evaluate((el) =>
    [el, ...el.querySelectorAll("*")]
      .filter((node) => !(node instanceof SVGElement))
      .filter((node) => {
        const style = getComputedStyle(node);
        return (
          [style.overflowX, style.overflowY].some((value) => value !== "visible") ||
          style.maskImage !== "none" ||
          style.webkitLineClamp !== "none"
        );
      })
      .map((node) => node.getAttribute("class") || node.tagName),
  );

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
]) {
  test(`the rail stays beside the post with its tree, meter, and Share (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(POST);
    const aside = rail(page);
    // The short title: the first sentence of the post's.
    await expect(aside.locator(".rail-title")).toHaveText("Paid AI plans often sit unopened.");
    const tree = aside.getByRole("navigation", { name: "On this page" });
    await expect(tree.getByRole("link")).toHaveText([
      "What the numbers say",
      "What they don’t say",
      "Two readers, two kinds of use",
      "What your plan may already include",
      "Putting the idle part to work",
      "Which path fits you",
      "Limits worth knowing",
    ]);
    // No meter pinned over the text on a wide screen: the rail carries it.
    await expect(page.locator('[data-read-progress="bar"]')).toBeHidden();
    const meter = page.locator('[data-read-progress="rail"]');
    await expect(meter).toBeVisible();
    await expect(meter.locator("[data-read-percent]")).toHaveText("0%");

    // Mid-article: the rail is still in view and the percent has moved. Where all of it fits the
    // window it is pinned 1.5rem under the header; where it does not, its foot holds 1.5rem above
    // the window's bottom, so Share and the meter stay on screen.
    const whole = await fits(page, viewport.height);
    await expect.poll(() => aside.evaluate((el) => el.hasAttribute("data-rail-fits"))).toBe(whole);
    await scrollToMiddle(page);
    await expect.poll(() => percent(page, "rail")).toBeGreaterThan(20);
    await expect(meter.locator("[data-read-percent]")).toHaveText(/^\d+%$/);
    const box = (await aside.boundingBox())!;
    if (whole) {
      expect(Math.abs(box.y - ((await headerBottom(page)) + 1.5 * REM))).toBeLessThan(2);
      for (const link of await tree.getByRole("link").all()) await expect(link).toBeInViewport({ ratio: 1 });
    } else {
      expect(Math.abs(box.y + box.height - (viewport.height - 1.5 * REM))).toBeLessThan(2);
    }
    await expect(meter).toBeInViewport({ ratio: 1 });
    await expect(aside.locator("[data-share]")).toBeInViewport({ ratio: 1 });
    await expect(tree.locator('a[aria-current="location"]')).toHaveCount(1);
    // The rail never overlaps the reading column.
    const prose = (await page.locator("[data-prose]").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(prose.x);

    // The end of the post reads 100%.
    await page.evaluate(() => {
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 2);
    });
    await expect.poll(() => percent(page, "rail")).toBe(100);
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1440, height: 700 },
  { width: 1280, height: 800 },
  { width: 1024, height: 640 },
]) {
  test(`the rail reads title, tree, meter, Sources, Share, and nothing in it is cut off (${viewport.width}×${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(POST);
    const aside = rail(page);
    const blocks = [
      ".rail-title",
      "[data-toc]",
      '[data-read-progress="rail"]',
      "[data-rail-sources]",
      "[data-share]",
    ];
    const tops: number[] = [];
    for (const selector of blocks) {
      const block = aside.locator(selector);
      await expect(block).toBeVisible();
      tops.push((await block.boundingBox())!.y);
    }
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    // Nothing in the rail scrolls inside itself, fades, or clamps its lines.
    expect(await clippers(page)).toEqual([]);

    // The first four sources, whole, then the button; the rest wait behind it.
    const entries = aside.locator("[data-rail-sources] ol > li");
    await expect(entries).toHaveCount(9);
    await expect(aside.locator("[data-rail-sources] ol > li:visible")).toHaveCount(4);
    const toggle = aside.locator("[data-sources-toggle]");
    await expect(toggle).toHaveAccessibleName("Show all 9 sources");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "rail-sources-list");

    // Open all nine mid-article: each one is whole inside the window (the page is the only
    // scroller), at its full size (nothing in it is cut), and the rail still ends in the window.
    await scrollToMiddle(page, 0.3);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("Show fewer sources");
    await expect(aside.locator("[data-rail-sources] ol > li:visible")).toHaveCount(9);
    expect(await clippers(page)).toEqual([]);
    for (const entry of await entries.all()) {
      const box = await scrollToSee(page, entry);
      expect(box.y).toBeGreaterThanOrEqual(await headerBottom(page));
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      const { scrollHeight, clientHeight } = await entry.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(scrollHeight).toBeLessThanOrEqual(clientHeight + 1);
    }
    await scrollToMiddle(page, 0.5);
    const box = (await aside.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await expect(aside.locator("[data-share]")).toBeInViewport({ ratio: 1 });
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1440, height: 700 },
]) {
  test(`the rail stops at the article's end, clear of "More from rotli" and the footer (${viewport.width}×${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(POST);
    await rail(page).getByRole("button", { name: "Show all 9 sources" }).click();
    const more = page.locator("[data-article-more]");
    const footer = page.locator(".site-footer-shell");
    for (const where of ["more", "footer", "bottom"] as const) {
      await page.evaluate((where) => {
        document.documentElement.style.scrollBehavior = "auto";
        const target =
          where === "more"
            ? document.querySelector<HTMLElement>("[data-article-more]")!
            : document.querySelector<HTMLElement>(".site-footer-shell")!;
        if (where === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
        else window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2);
      }, where);
      const railBox = (await rail(page).boundingBox())!;
      const prose = (await page.locator("[data-prose]").boundingBox())!;
      expect(railBox.y + railBox.height).toBeLessThanOrEqual(prose.y + prose.height + 1);
      expect(railBox.y + railBox.height).toBeLessThanOrEqual((await more.boundingBox())!.y);
      expect(railBox.y + railBox.height).toBeLessThanOrEqual((await footer.boundingBox())!.y);
    }
  });
}

test("Show all is a real button that opens and closes from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  const block = rail(page).locator("[data-rail-sources]");
  const visible = block.locator("ol > li:visible");
  // Tab reaches it after the fourth source's link.
  await block.locator("ol a").nth(3).focus();
  await page.keyboard.press("Tab");
  const toggle = block.locator("[data-sources-toggle]");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveRole("button");
  await expect(toggle).toHaveAccessibleName("Show all 9 sources");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(visible).toHaveCount(9);
  await expect(toggle).toBeFocused();
  // The newly shown sources come next in the tab order, before the button.
  await block.locator("ol a").nth(8).focus();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toHaveText("Show all 9 sources");
  await expect(visible).toHaveCount(4);
});

test("without script, every source shows and there is no button", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(POST);
  const block = page.locator("[data-rail-sources]");
  await expect(block.locator("ol > li:visible")).toHaveCount(9);
  await expect(block.getByRole("button")).toBeHidden();
  // It scrolls with the page: the last source is reachable and whole.
  await block.locator("ol > li").last().scrollIntoViewIfNeeded();
  await expect(block.locator("ol > li").last()).toBeInViewport({ ratio: 1 });
  await context.close();
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`on a narrow screen the article keeps its full Sources list (${viewport.width}px)`, async ({
    browser,
  }) => {
    for (const javaScriptEnabled of [true, false]) {
      const context = await browser.newContext({ javaScriptEnabled, viewport });
      const page = await context.newPage();
      await page.goto(POST);
      await expect(page.locator("[data-rail-sources]")).toBeHidden();
      const list = page.locator("[data-prose] h2#sources + ol > li");
      await expect(page.locator("[data-prose] h2#sources")).toBeVisible();
      await expect(list).toHaveCount(9);
      for (const item of await list.all()) await expect(item).toBeVisible();
      // The disclosure leads to it.
      await expect(page.locator('.toc-compact a[href="#sources"]')).toHaveCount(1);
      await context.close();
    }
  });
}

test("the rail's Sources come from the post's own list and link out in a new tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  const block = rail(page).locator("[data-rail-sources]");
  await expect(block.getByText("Sources", { exact: true })).toBeVisible();
  // The article's list is the one source of truth: same count, same order, same addresses.
  const articleLinks = await page
    .locator("[data-prose] h2#sources + ol > li")
    .evaluateAll((items) => items.map((item) => item.querySelector("a")!.getAttribute("href")));
  expect(articleLinks).toHaveLength(9);
  const links = block.locator("ol a");
  await expect(links).toHaveCount(articleLinks.length);
  expect(await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")))).toEqual(articleLinks);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(new URL((await link.getAttribute("href"))!).protocol).toBe("https:");
  }
  await expect(links.first()).toContainText("Self Financial");
  await expect(links.first()).toContainText("The Cost of Unused Paid Subscriptions 2026");
  await expect(links.nth(3)).toContainText("Chatterji et al.");
  // On a wide screen this is the post's one Sources list: the tree leaves the heading out, and
  // the article's own list gives way to "More from rotli" (print and the Markdown twin keep it).
  await expect(rail(page).locator("[data-toc] a", { hasText: /^Sources$/ })).toHaveCount(0);
  await expect(page.locator("[data-prose] h2#sources")).toBeHidden();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-prose] h2#sources")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  const twin = await (await page.request.get(`${POST}index.md`)).text();
  expect(twin).toContain("## Sources");
  for (const href of articleLinks) expect(twin).toContain(href!);
});

test("a post without a Sources section shows no Sources block", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/rotli-web-and-your-mac/");
  await expect(rail(page).locator("[data-toc]")).toBeVisible();
  await expect(page.locator("[data-rail-sources]")).toHaveCount(0);
});

test("Share has its five ways, each with an icon", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  const share = rail(page).locator("[data-share]");
  const items = share.locator("li:visible");
  await expect(items).toHaveText(["X", "LinkedIn", "Email", "Copy link", "Copy Markdown"]);
  for (const item of await items.all()) await expect(item.locator("svg.icon")).toBeVisible();
});

test("Share is plain links that carry the post, and loads nothing from those sites", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const thirdParty: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1")) thirdParty.push(request.url());
  });
  await page.goto(POST);
  const share = rail(page).locator("[data-share]");
  const title = (await page.locator("h1").textContent())!.trim();
  const x = new URL((await share.getByRole("link", { name: "X" }).getAttribute("href"))!);
  expect(x.origin + x.pathname).toBe("https://x.com/intent/post");
  expect(x.searchParams.get("url")).toBe(URL_OF_POST);
  expect(x.searchParams.get("text")).toBe(title);
  const linkedIn = new URL((await share.getByRole("link", { name: "LinkedIn" }).getAttribute("href"))!);
  expect(linkedIn.origin + linkedIn.pathname).toBe("https://www.linkedin.com/sharing/share-offsite/");
  expect(linkedIn.searchParams.get("url")).toBe(URL_OF_POST);
  for (const name of ["X", "LinkedIn"]) {
    await expect(share.getByRole("link", { name })).toHaveAttribute("rel", "noopener noreferrer");
  }
  const mail = (await share.getByRole("link", { name: "Email" }).getAttribute("href"))!;
  expect(mail.startsWith("mailto:?subject=")).toBe(true);
  expect(decodeURIComponent(mail)).toContain(URL_OF_POST);
  // Only this site's own files were requested (the footer's badge is outside the article).
  expect(thirdParty.filter((url) => /x\.com|twitter|linkedin/.test(url))).toEqual([]);
});

test("Copy link and Copy Markdown write the post's address and its Markdown twin", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  const share = rail(page).locator("[data-share]");
  const status = share.getByRole("status");
  await share.getByRole("button", { name: "Copy link" }).click();
  await expect(status).toHaveText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(URL_OF_POST);

  const twin = page.waitForResponse((response) =>
    response.url().endsWith("/blog/the-ai-you-already-pay-for/index.md"),
  );
  await share.getByRole("button", { name: "Copy Markdown" }).click();
  expect((await twin).status()).toBe(200);
  await expect(status).toHaveText("Markdown copied");
  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  expect(markdown.startsWith("# Paid AI plans")).toBe(true);
  // The figures arrive as tables, never as chart syntax.
  expect(markdown).toContain("| ChatGPT | 50.4% |");
  expect(markdown).not.toContain("```figure");
});

test("without script, Share keeps its links and hides the copy buttons", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(POST);
  const share = page.locator("[data-share]");
  await expect(share.getByRole("link", { name: "X" })).toBeVisible();
  await expect(share.getByRole("button", { name: "Copy Markdown" })).toBeHidden();
  await context.close();
});

test("J and K are plain keys: no section jumps, no hint", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(POST);
  await expect(page.locator("kbd")).toHaveCount(0);
  await expect(page.getByText(/to move between sections/)).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, 600);
  });
  await settled(page);
  const before = await page.evaluate(() => window.scrollY);
  for (const key of ["j", "j", "k", "J", "K"]) await page.keyboard.press(key);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("a jump from the rail's tree lands below the header", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(POST);
  const links = rail(page).locator("[data-toc] a");
  for (const index of [1, (await links.count()) - 1]) {
    const link = links.nth(index);
    const id = decodeURIComponent((await link.getAttribute("href"))!.slice(1));
    await link.click();
    await settled(page);
    const landed = (await page.locator(`[id="${id}"]`).boundingBox())!.y;
    expect(landed).toBeGreaterThanOrEqual(await headerBottom(page));
    expect(landed).toBeLessThan(400);
  }
});

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`on a narrow screen: the disclosure, a slim bar, and Share after the post (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(POST);
    await expect(rail(page).locator(".rail-toc")).toBeHidden();
    await expect(page.locator('[data-read-progress="rail"]')).toBeHidden();
    const share = rail(page).locator("[data-share]");
    await expect(share.getByRole("link", { name: "LinkedIn" })).toBeVisible();
    const prose = (await page.locator("[data-prose]").boundingBox())!;
    expect((await share.boundingBox())!.y).toBeGreaterThan(prose.y + prose.height);

    // The slim bar: a few pixels under the header, filling as the post scrolls.
    const bar = page.locator('[data-read-progress="bar"]');
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight / 2);
    });
    await expect(bar).toBeVisible();
    await expect.poll(() => percent(page, "bar")).toBeGreaterThan(20);
    const barBox = (await bar.boundingBox())!;
    expect(barBox.height).toBeLessThanOrEqual(4);
    expect(Math.abs(barBox.y - (await headerBottom(page)))).toBeLessThan(2);

    // A jump from the disclosure lands below the header and the bar.
    await page.evaluate(() => window.scrollTo(0, 0));
    const compact = page.locator(".toc-compact");
    await compact.locator("summary").click();
    const link = compact.locator("a").nth(2);
    const id = decodeURIComponent((await link.getAttribute("href"))!.slice(1));
    await link.click();
    await settled(page);
    const landed = (await page.locator(`[id="${id}"]`).boundingBox())!.y;
    expect(landed).toBeGreaterThanOrEqual((await headerBottom(page)) + 3);
    expect(landed).toBeLessThan(400);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
}
