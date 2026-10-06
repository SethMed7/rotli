// A blog post's left rail (blog/ArticleRail.astro): in view beside the text on a wide screen
// with the title, the "On this page" tree, the reading meter as a percent, and Share (plain
// links, Copy link, Copy Markdown from the post's twin); J and K do nothing (the owner,
// 2026-10-06); jumps land below the header; and on a phone the tree is
// the disclosure, the meter a slim bar under the header, and Share follows the article.
import { expect, test, type Page } from "@playwright/test";

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

    // Mid-article: the rail is still in view under the header, whole (nothing clipped), and the
    // percent has moved.
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight / 2);
    });
    await expect.poll(() => percent(page, "rail")).toBeGreaterThan(20);
    await expect(meter.locator("[data-read-percent]")).toHaveText(/^\d+%$/);
    const box = (await aside.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual((await headerBottom(page)) + 8);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    for (const link of await tree.getByRole("link").all()) {
      const linkBox = (await link.boundingBox())!;
      expect(linkBox.y).toBeGreaterThanOrEqual(box.y);
      expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
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
  { width: 1280, height: 800 },
  { width: 1024, height: 640 },
]) {
  test(`the rail reads title, tree, meter, Sources, Share, and fits the window (${viewport.width}×${viewport.height})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(POST);
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + 400);
    });
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
    // Never taller than the window. Share is whole at its foot; in a window too short for even
    // that, the rail itself scrolls and Share is reached by scrolling it (nothing is cut off).
    const box = (await aside.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual((await headerBottom(page)) + 8);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const shareBottom = async () => {
      const share = (await aside.locator("[data-share]").boundingBox())!;
      return share.y + share.height;
    };
    if (viewport.height >= 800) expect(await shareBottom()).toBeLessThanOrEqual(box.y + box.height + 1);
    else {
      expect(await aside.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
      await aside.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      expect(await shareBottom()).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    // The sources list keeps a few rows in view; when it is cut short it scrolls inside itself.
    const list = aside.locator("[data-rail-sources] ol");
    const listBox = (await list.boundingBox())!;
    expect(listBox.height).toBeGreaterThanOrEqual(60);
    const { scrollHeight, clientHeight, overflowY } = await list.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    if (scrollHeight > clientHeight + 1) expect(overflowY).toBe("auto");
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
  // The tree leaves the Sources heading to this block, which links to the full citations.
  await expect(rail(page).locator("[data-toc] a", { hasText: /^Sources$/ })).toHaveCount(0);
  await block.getByRole("link", { name: "Full citations" }).click();
  await settled(page);
  const landed = (await page.locator("h2#sources").boundingBox())!.y;
  expect(landed).toBeGreaterThanOrEqual(await headerBottom(page));
  expect(landed).toBeLessThan(400);
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
