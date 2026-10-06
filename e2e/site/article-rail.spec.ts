// A blog post's left rail (blog/ArticleRail.astro): in view beside the text on a wide screen
// with the title, the "On this page" tree, the reading meter as a percent, the J/K hint, and
// Share (plain links, Copy link, Copy Markdown from the post's twin); J and K move between
// sections and never act while typing; jumps land below the header; and on a phone the tree is
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
  { width: 1024, height: 768 },
]) {
  test(`the rail stays beside the post with its tree, meter, and Share (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(POST);
    const aside = rail(page);
    await expect(aside.locator(".rail-title")).toHaveText(/Paid AI plans/);
    const tree = aside.getByRole("navigation", { name: "On this page" });
    await expect(tree.getByRole("link")).toHaveText([
      "What the numbers say",
      "What they don’t say",
      "Putting the idle part to work",
      "Sources",
    ]);
    // No meter pinned over the text on a wide screen: the rail carries it.
    await expect(page.locator('[data-read-progress="bar"]')).toBeHidden();
    const meter = page.locator('[data-read-progress="rail"]');
    await expect(meter).toBeVisible();
    await expect(meter.locator("[data-read-percent]")).toHaveText("0%");
    await expect(aside.locator("[data-section-keys-hint]")).toBeVisible();

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
  await expect(page.locator("[data-section-keys-hint]")).toBeHidden();
  await context.close();
});

test("J and K move between sections, and never act while typing or with a modifier", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(POST);
  const headings = page.locator("[data-prose] h2");
  const top = async (index: number) => (await headings.nth(index).boundingBox())!.y;
  const header = await headerBottom(page);

  await page.keyboard.press("j");
  await settled(page);
  expect(Math.abs((await top(0)) - header - 24)).toBeLessThan(6);
  await page.keyboard.press("j");
  await settled(page);
  expect(Math.abs((await top(1)) - header - 24)).toBeLessThan(6);
  await page.keyboard.press("k");
  await settled(page);
  expect(Math.abs((await top(0)) - header - 24)).toBeLessThan(6);

  // Typing a "j" in a field types it; the page does not move.
  const field = page.getByRole("textbox").first();
  await field.focus();
  const before = await page.evaluate(() => window.scrollY);
  await page.keyboard.type("jkjk");
  await expect(field).toHaveValue("jkjk");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // A modifier passes the key through to the browser.
  await field.blur();
  await page.keyboard.press("Control+j");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // The arrow keys still scroll the page as they always do.
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
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
