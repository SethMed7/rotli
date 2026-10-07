// /privacy/ reads like a blog post (the owner, 2026-10-06: "Privacy page design should match blog
// styles"): WritingPage's `article` layout on the header's edges. The head is the title, the lede,
// and "Updated …" beside the night scene from 1000px (stacked, the scene first, below it), the
// scene rounded and contained, its caption on its own night ground above the dome, the clouds kept
// inside the frame. The body is the left rail (the short title, the tree, the meter as a percent,
// and Share as Copy link alone, no Sources) beside the reading column, and "More from rotli" after
// it with the posts about privacy. On a phone the tree is the disclosure, the meter a slim bar, and
// Copy link follows the article. The full-width pinned banner is gone. `#promise` (the hero's and
// the landing band's link) lands just under the header at every width, and nothing scrolls
// sideways from 320 to 2560. The matrix itself: privacy-promise.spec.ts.
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
/** Where the words and the scene go side by side (blog/ArticleCover.astro). */
const SIDE_BY_SIDE = 1000;

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
  test(`/privacy/ opens on its title beside the night scene, or under it when narrow (${viewport.width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/privacy/");
    // The post's head, not the old full-width pinned banner.
    await expect(page.locator("[data-article-banner]")).toHaveCount(0);
    const head = page.locator("[data-article-cover] .head-copy");
    await expect(head.getByRole("heading", { level: 1 })).toHaveText("Privacy");
    await expect(head.locator(".lede")).toHaveText(
      "rotli is built so there is nothing about you to collect. This page explains exactly what it does with your data, what connects to the internet, and why it works that way.",
    );
    // The meta line is the date alone: no author's mark or name, and no topics.
    await expect(head.locator(".byline")).toHaveText(/^Updated \w+ \d{1,2}, \d{4}$/);
    await expect(head.locator(".author, .avatar")).toHaveCount(0);
    await expect(head.locator(".tags")).toHaveCount(0);
    const [title, lede, byline] = await Promise.all(
      ["h1", ".lede", ".byline"].map((part) => box(page, `[data-article-cover] .head-copy ${part}`)),
    );
    expect(lede!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1);
    expect(byline!.y).toBeGreaterThanOrEqual(lede!.y + lede!.height - 1);
    expect(title!.y + title!.height).toBeLessThanOrEqual(viewport.height);

    // The scene: contained in the page's width, rounded, under the header, clipping its drifting
    // clouds, with the caption above the dome and never over it.
    const scene = page.locator("[data-article-scene]");
    await expect(scene.locator(".night-caption")).toContainText("Secure notes stay home.");
    const art = await box(page, "[data-article-scene]");
    const wrap = await box(page, "main.writing");
    expect(art.x).toBeGreaterThanOrEqual(wrap.x - 1);
    expect(art.x + art.width).toBeLessThanOrEqual(wrap.x + wrap.width + 1);
    expect(art.width).toBeLessThan(viewport.width);
    expect(art.y).toBeGreaterThan(await headerBottom(page));
    const frame = await scene.evaluate((el) => {
      const style = getComputedStyle(el);
      return { radius: style.borderTopLeftRadius, overflow: style.overflow };
    });
    expect(frame.radius).not.toBe("0px");
    expect(frame.overflow).toBe("hidden");
    const caption = await box(page, "[data-article-scene] .night-caption");
    const dome = await box(page, "[data-article-scene] .dome-frame");
    expect(caption.y + caption.height).toBeLessThanOrEqual(dome.y + 1);
    for (const part of [caption, dome]) {
      expect(part.x).toBeGreaterThanOrEqual(art.x - 1);
      expect(part.x + part.width).toBeLessThanOrEqual(art.x + art.width + 1);
      expect(part.y + part.height).toBeLessThanOrEqual(art.y + art.height + 1);
    }
    // The caption reads on its own opaque night, and its inked phrase too.
    for (const text of [".night-caption", ".night-caption .inked"]) {
      const { fg, bg } = await colours(
        page,
        `[data-article-scene] ${text}`,
        "[data-article-scene] .night-caption",
      );
      expect(contrastOf(fg, bg), text).toBeGreaterThanOrEqual(4.5);
    }

    const copy = await box(page, "[data-article-cover] .head-copy");
    if (viewport.width >= SIDE_BY_SIDE) {
      // The words on the left, the scene on the right, overlapping in height, neither over the other.
      expect(copy.x + copy.width).toBeLessThan(art.x);
      expect(copy.y).toBeLessThan(art.y + art.height);
      expect(art.y).toBeLessThan(copy.y + copy.height);
    } else {
      expect(copy.y).toBeGreaterThanOrEqual(art.y + art.height);
    }
    if (viewport.width > 900) {
      // On the header's edges, like a post: the words and the rail on the left one, the scene
      // ending on the right one.
      const header = await box(page, ".site-header");
      const rail = await box(page, "[data-article-rail]");
      expect(Math.abs(copy.x - header.x)).toBeLessThan(1.5);
      expect(Math.abs(rail.x - header.x)).toBeLessThan(1.5);
      expect(Math.abs(art.x + art.width - (header.x + header.width))).toBeLessThan(1.5);
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
  test(`/privacy/'s rail: its title, the tree, the meter, and Copy link alone (${viewport.width}px)`, async ({
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
    // No Sources on a policy; Share is Copy link alone (no X, LinkedIn, email, or Markdown).
    await expect(rail.locator("[data-rail-sources]")).toHaveCount(0);
    const share = rail.locator("[data-share]");
    await expect(share).toBeVisible();
    await expect(share.locator("a")).toHaveCount(0);
    await expect(share.getByRole("button")).toHaveText(["Copy link"]);
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
  // Copy link follows the article and comes before "More from rotli".
  const share = page.locator("[data-share]");
  await expect(share.getByRole("button")).toHaveText(["Copy link"]);
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
