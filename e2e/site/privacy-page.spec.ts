// /privacy/ reads like a blog post (the owner, 2026-10-06: "Privacy page design should match blog
// styles", and 2026-10-09: match "The AI you already pay for"): WritingPage's `article` layout on
// the header's edges. It opens as a post does since 2026-10-09 ("one thing straight across top like
// an image/banner then the rest under"): its picture a banner straight across the window under the
// header, edge to edge and square cornered, scrolling away with the page (the old pinned banner is
// gone), and under it, on the reading column, the title, the lede, the byline (the author,
// "Updated …", the reading time), and the topic chips. The body is the left rail (the short title,
// the tree, the meter as a percent, and Share as a post's, Copy Markdown from the page's twin
// included, no Sources) beside the reading column, and "More from rotli" after it with the posts
// about privacy. On a phone the tree is the disclosure, the meter a slim bar, and Copy link
// follows the article. `#promise` (the hero's and the landing band's link) lands just under the
// header at every width, and nothing scrolls sideways from 320 to 2560. The matrix itself:
// privacy-promise.spec.ts.
import { expect, test, type Page } from "@playwright/test";

const SECTIONS = [
  "Our privacy promise",
  "Your notes stay yours",
  "What connects to the internet",
  "AI and your notes",
  "How rotli connects to AI",
  "Rotli Web and Rotli Helper",
  "Keys and logins",
  "This website",
  "Keeping and deleting",
  "Changes to this page",
];
/** Where the banner shows the phone crop (blog/ArticleBanner.astro). */
const PHONE = 700;

/** WCAG contrast of two computed colours (rgb()/rgba() or color(srgb …)); throws on transparency. */
function contrastOf(fg: string, bg: string): number {
  const parse = (value: string) => {
    const srgb = value.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
    if (srgb) return { rgb: srgb.slice(1, 4).map(Number), alpha: Number(srgb[4] ?? 1) };
    const rgb = value.match(/rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/);
    if (!rgb) throw new Error(`unparsed colour ${value}`);
    return { rgb: rgb.slice(1, 4).map((c) => Number(c) / 255), alpha: Number(rgb[4] ?? 1) };
  };
  const lum = (value: string) => {
    const { rgb, alpha } = parse(value);
    if (alpha !== 1) throw new Error(`${value} is not opaque, so its contrast means nothing`);
    const [r = 0, g = 0, b = 0] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const colours = (page: Page, text: string, ground: string) =>
  page.evaluate(
    ({ textSel, groundSel }) => ({
      fg: getComputedStyle(document.querySelector(textSel)!).color,
      bg: getComputedStyle(document.querySelector(groundSel)!).backgroundColor,
    }),
    { textSel: text, groundSel: ground },
  );

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

const headerBottom = async (page: Page) => {
  const header = await box(page, ".site-header-bar");
  return header.y + header.height;
};

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function settled(page: Page) {
  await expect
    .poll(async () => {
      const before = await page.evaluate(() => window.scrollY);
      await page.waitForTimeout(150);
      return (await page.evaluate(() => window.scrollY)) === before;
    })
    .toBe(true);
}

for (const viewport of [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 999, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`/privacy/ opens like a post: its banner straight across the top, its title under it (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/privacy/");
    // Not the old pinned banner: a post's, which scrolls away with the page (article-banner.spec.ts).
    await expect(page.locator("[data-article-banner]")).toHaveCount(0);
    const head = page.locator("[data-article-cover] .head-copy");
    await expect(head.getByRole("heading", { level: 1 })).toHaveText("Privacy");
    await expect(head.locator(".lede")).toHaveText(
      "rotli is built so there is nothing about you to collect. This page explains exactly what it does with your data, what connects to the internet, and why it works that way.",
    );
    // A post's byline and topics: the author, the date it was updated, the reading time.
    await expect(head.locator(".byline")).toContainText("Seth Medina");
    await expect(head.locator(".byline")).toContainText(/Updated \w+ \d{1,2}, \d{4}/);
    await expect(head.locator(".byline")).toContainText(/\d+ min read/);
    await expect(head.locator(".tags li")).toHaveText(["Privacy", "AI", "Security"]);
    const [title, lede, byline] = await Promise.all(
      ["h1", ".lede", ".byline"].map((part) => box(page, `[data-article-cover] .head-copy ${part}`)),
    );
    expect(lede!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
    expect(byline!.y).toBeGreaterThanOrEqual(lede!.y + lede!.height - 1);
    expect(title!.y + title!.height).toBeLessThanOrEqual(viewport.height);

    // The banner: a post's, straight across the window under the header, outside the page's
    // wrapper, square cornered, described for assistive tech.
    await expect(page.locator("main [data-article-art]")).toHaveCount(0);
    const picture = page.locator("[data-article-art] img");
    await expect(picture).toHaveAttribute("alt", /padlock/);
    await expect
      .poll(() => picture.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    const art = await box(page, "[data-article-art]");
    const windowWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.abs(art.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(art.width - windowWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(art.y - (await headerBottom(page)))).toBeLessThanOrEqual(1);
    expect(
      await page.locator("[data-article-art]").evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
    ).toBe("0px");
    // The wide scene, cropped only off the top and bottom; on a phone the quokka crop, whole.
    const shape = await picture.evaluate((el: HTMLImageElement) => ({
      src: el.currentSrc,
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      natural: el.naturalWidth / el.naturalHeight,
    }));
    expect(shape.height).toBeLessThanOrEqual(shape.width / shape.natural + 1);
    if (viewport.width > PHONE) {
      expect(shape.src).toMatch(/\.webp$/);
      expect(shape.src).not.toMatch(/-mobile\.webp$/);
    } else {
      expect(shape.src).toMatch(/-mobile\.webp$/);
      expect(Math.abs(shape.width / shape.height - shape.natural)).toBeLessThan(0.02);
    }

    // The words under the banner, on the reading column: they start where the page's words do,
    // past the rail (on the header's left edge) from 901px, on the page's left edge below that.
    const copy = await box(page, "[data-article-cover] .head-copy");
    expect(copy.y).toBeGreaterThanOrEqual(art.y + art.height);
    const column = await box(page, "[data-prose] > p");
    expect(Math.abs(copy.x - column.x)).toBeLessThan(1.5);
    const header = await box(page, ".site-header");
    if (viewport.width > 900) {
      const rail = await box(page, "[data-article-rail]");
      expect(Math.abs(rail.x - header.x)).toBeLessThan(1.5);
      expect(copy.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    } else {
      expect(Math.abs(copy.x - header.x)).toBeLessThan(1.5);
    }
    for (const text of ["h1", ".lede", ".byline"]) {
      const { fg, bg } = await colours(page, `[data-article-cover] .head-copy ${text}`, "body");
      expect(contrastOf(fg, bg), text).toBeGreaterThanOrEqual(4.5);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test(`/privacy/'s rail: its title, the tree, the meter, and a post's Share (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/privacy/");
    const rail = page.getByRole("complementary", { name: "About this page" });
    await expect(rail).toBeVisible();
    await expect(rail.locator(".rail-title")).toHaveText("Privacy");
    const tree = rail.getByRole("navigation", { name: "On this page" });
    await expect(tree.getByRole("link")).toHaveText(SECTIONS);
    await expect(tree.getByRole("link").first()).toHaveAttribute("href", "#promise");
    // No Sources on a policy; Share is a post's: X, LinkedIn, Email, Copy link, Copy Markdown.
    await expect(rail.locator("[data-rail-sources]")).toHaveCount(0);
    const share = rail.locator("[data-share]");
    await expect(share).toBeVisible();
    await expect(share.locator("a")).toHaveText(["X", "LinkedIn", "Email"]);
    await expect(share.locator("a").first()).toHaveAttribute("href", /privacy%20promise/);
    await expect(share.getByRole("button")).toHaveText(["Copy link", "Copy Markdown"]);
    await expect(share.getByRole("button", { name: "Copy Markdown" })).toHaveAttribute(
      "data-copy-src",
      "/privacy/index.md",
    );
    await expect(share.getByRole("button", { name: "Copy link" })).toHaveAttribute(
      "data-copy-value",
      /\/privacy\/$/,
    );

    // The meter is the rail's percent; nothing is pinned over the text on a wide screen.
    await expect(page.locator('[data-read-progress="bar"]')).toBeHidden();
    const meter = page.getByRole("progressbar", { name: "Position in this page" });
    await expect(meter).toHaveAttribute("data-read-progress", "rail");
    await expect(meter.locator("[data-read-percent]")).toHaveText("0%");
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().top + window.scrollY + prose.offsetHeight / 2);
    });
    await expect.poll(() => meter.getAttribute("aria-valuenow").then(Number)).toBeGreaterThan(20);
    await expect(meter).toBeInViewport({ ratio: 1 });
    await expect(tree.locator('a[aria-current="location"]')).toHaveCount(1);
    const aside = (await rail.boundingBox())!;
    const prose = await box(page, "[data-prose]");
    expect(aside.x + aside.width).toBeLessThanOrEqual(prose.x);

    // The end of the article reads 100%, and the rail stops before "More from rotli".
    await page.evaluate(() => {
      const prose = document.querySelector<HTMLElement>("[data-prose]")!;
      window.scrollTo(0, prose.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 2);
    });
    await expect.poll(() => meter.getAttribute("aria-valuenow").then(Number)).toBe(100);
    await page.locator("[data-article-more]").scrollIntoViewIfNeeded();
    const end = (await rail.boundingBox())!;
    const more = await box(page, "[data-article-more]");
    expect(end.y + end.height).toBeLessThanOrEqual(more.y);
  });
}

test("/privacy/ on a phone: the tree's disclosure, the slim bar, and Copy link after the article", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/privacy/");
  await expect(page.locator("[data-article-rail] .rail-toc")).toBeHidden();
  await expect(page.locator('[data-read-progress="rail"]')).toBeHidden();
  const compact = page.locator(".toc-compact");
  await expect(compact).toBeVisible();
  await compact.locator("summary").click();
  await expect(compact.getByRole("link")).toHaveText(SECTIONS);
  // A jump closes the disclosure and lands under the header and the slim bar.
  await compact.getByRole("link", { name: "This website" }).click();
  await settled(page);
  await expect(compact).not.toHaveAttribute("open", "");
  const target = await box(page, "#website");
  const bar = page.locator('[data-read-progress="bar"]');
  await expect(bar).toBeVisible();
  const barBox = (await bar.boundingBox())!;
  expect(target.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
  expect(target.y).toBeLessThan(400);
  expect(Math.abs(barBox.y - (await headerBottom(page)))).toBeLessThan(2);
  // Share follows the article and comes before "More from rotli".
  const share = page.locator("[data-share]");
  await expect(share.getByRole("button")).toHaveText(["Copy link", "Copy Markdown"]);
  const prose = await box(page, "[data-prose]");
  const shareBox = (await share.boundingBox())!;
  const more = await box(page, "[data-article-more]");
  expect(shareBox.y).toBeGreaterThanOrEqual(prose.y + prose.height);
  expect(shareBox.y + shareBox.height).toBeLessThanOrEqual(more.y);
});

test("/privacy/ ends on the posts about privacy and rotli's own spots", async ({ page }) => {
  await page.goto("/privacy/");
  const more = page.locator("[data-article-more]");
  await expect(more.getByRole("heading", { level: 2 })).toHaveText("More from rotli");
  const posts = more.locator("[data-more-post] a");
  expect(await posts.count()).toBeGreaterThan(0);
  for (const href of await posts.evaluateAll((links) => links.map((link) => link.getAttribute("href"))))
    expect(href).toMatch(/^\/blog\/[\w-]+\/$/);
  await expect(more.locator('[data-more-post="soon"]')).toHaveCount(0);
  const promos = await more
    .locator("[data-promo]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-promo")));
  expect(promos.length).toBeGreaterThan(0);
  for (const id of promos) expect(["download", "web"]).toContain(id);
});

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`/privacy/#promise lands on the promise just under the header (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/privacy/#promise");
    await settled(page);
    const heading = page.locator("#promise");
    await expect(heading).toHaveText("Our privacy promise");
    await expect(page.locator("[data-prose] > :first-child")).toHaveId("promise");
    const top = await headerBottom(page);
    const bar = page.locator('[data-read-progress="bar"]');
    const barBottom = (await bar.isVisible())
      ? (await bar.boundingBox())!.y + (await bar.boundingBox())!.height
      : top;
    const landed = (await heading.boundingBox())!.y;
    expect(landed).toBeGreaterThanOrEqual(Math.max(top, barBottom));
    expect(landed).toBeLessThan(top + 56);
    // Its lead line follows in the same window.
    await expect(page.locator(".promise-lede")).toBeInViewport();
  });
}

for (const width of [320, 360, 390, 414, 600, 660, 768, 900, 901, 999, 1000, 1024, 1280, 1440, 1920, 2560]) {
  test(`/privacy/ never scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/privacy/");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Nothing in the article runs past the page's edges either (a clipped table would hide it).
    const widest = await page.locator("main.writing").evaluate((main) =>
      // The scene's clouds drift in from past its edges; its frame clips them, so its inner
      // drawing is left out (the frame itself is measured).
      Math.max(
        ...[...main.querySelectorAll("*")]
          .filter((el) => !(el instanceof SVGElement) || el.tagName.toLowerCase() === "svg")
          .map((el) => el.getBoundingClientRect().right),
      ),
    );
    expect(widest).toBeLessThanOrEqual(width + 0.5);
  });
}

// Keys and logins (the owner, 2026-10-07: "passwords and keys ... work different", so they get a
// section of their own): no rotli password, AI tools keep their own logins, the one optional key
// and its rules, the Helper's pairing code, and what rotli can and can't spot in a note.
test("keys and logins have their own section, linked from where the files are described", async ({
  page,
}) => {
  await page.goto("/privacy/");
  const link = page.locator("#your-notes ~ p a[href='#keys']").first();
  await expect(link).toHaveText("Keys and logins");
  await link.click();
  await expect(page).toHaveURL(/#keys$/);
  const section = page.locator("#keys ~ *:not(h2#website ~ *)");
  await expect(section.filter({ hasText: "no rotli password" })).toHaveCount(1);
  await expect(section.filter({ hasText: "never reads them" })).toHaveCount(1);
  await expect(section.filter({ hasText: "lives in the macOS Keychain" })).toHaveCount(1);
  await expect(section.filter({ hasText: "No AI model ever sees it" })).toHaveCount(1);
  await expect(section.filter({ hasText: "Brave Search" })).toHaveCount(1);
  await expect(section.filter({ hasText: "pairing code" })).toHaveCount(1);
  await expect(section.filter({ hasText: "mark that note secure yourself" })).toHaveCount(1);
});

// What the website keeps (the owner, 2026-10-07): unsubscribing, by the link or the mail app's
// button, erases the address within a day (site/server/unsubscribed.ts), the signup alert keeps
// one copy, and a request deletes that too;
// "Keeping and deleting" points to all of it, since its notes line alone read as "nothing kept".
test("the email list says how to erase an address, and Keeping and deleting points to the website", async ({
  page,
}) => {
  await page.goto("/privacy/");
  const list = page.locator("#website ~ p", { hasText: "The email list." });
  await expect(list).toContainText("Unsubscribe button works too");
  await expect(list).toContainText("within a day your address is erased from Resend");
  await expect(list.locator("a[href='/roadmap/#request']")).toHaveText("send a request");
  const retention = page.locator("#retention ~ p", { hasText: "This website keeps a little" });
  await expect(retention.locator("a[href='#website']")).toHaveText("This website");
  await expect(page.locator(".meta, [data-article-cover]").first()).toContainText("Updated October 7, 2026");
});

test("/privacy/'s reading time is counted the way a post's is", async ({ page }) => {
  await page.goto("/privacy/");
  // src/writing.ts readingMinutes: words / 230, at least 1. The page is written in Astro, not
  // Markdown, so its constant is checked against the words on the page.
  const words = await page
    .locator(".prose")
    .evaluate((el) => (el as HTMLElement).innerText.split(/\s+/).filter(Boolean).length);
  const shown = Number(
    (await page.locator("[data-article-cover] .byline").innerText()).match(/(\d+) min read/)![1],
  );
  expect(Math.abs(shown - Math.max(1, Math.round(words / 230)))).toBeLessThanOrEqual(1);
});

test("/privacy/ has a Markdown twin made from the page, for Copy Markdown and for agents", async ({
  page,
  request,
}) => {
  await page.goto("/privacy/");
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
    "href",
    "/privacy/index.md",
  );
  const twin = await request.get("/privacy/index.md");
  expect(twin.ok()).toBe(true);
  const text = await twin.text();
  expect(text.startsWith("# Privacy\n\n> rotli is built so there is nothing about you to collect.")).toBe(
    true,
  );
  // Every section of the page, in order, as a heading.
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  expect(headings).toHaveLength(SECTIONS.length);
  // The promise's table, as a table, its rows the page's.
  expect(text).toContain("| Note | On-device model (runs on your Mac) |");
  expect(text).toContain("| **Secure note** (Right-click → Mark secure) |");
  // Links are whole addresses; nothing decorative slips in.
  expect(text).not.toMatch(/\]\((?!https?:)/);
  expect(text).not.toMatch(/<[a-z]/i);
  expect(text.trimEnd().endsWith("Source: https://rotli.co/privacy/")).toBe(true);
});
