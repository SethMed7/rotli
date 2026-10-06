// The guides joined the blog on 2026-10-06: each is a post tagged Guide at /blog/<slug>/, its old
// /resources/<slug>/ address redirects there (astro.config.mjs `redirects`; site/Caddyfile in
// production), the Resources menu and page list no "Guides", /blog/ offers a Guide filter, and a
// guide never takes the featured story from a post.
import { expect, test } from "@playwright/test";

const GUIDES = {
  "getting-started": "Getting started",
  "why-local": "Why local?",
  "ai-and-your-notes": "What does AI see in rotli?",
  "rotli-helper": "What is Rotli Helper?",
  "web-and-mac": "rotli in the browser and on the Mac",
};

for (const [slug, title] of Object.entries(GUIDES)) {
  test(`/resources/${slug}/ redirects to its post, a Guide`, async ({ page }) => {
    await page.goto(`/resources/${slug}/`);
    await page.waitForURL(`**/blog/${slug}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.locator("[data-article-cover] .tags li").first()).toHaveText("Guide");
    await expect(page.locator("[data-article-art] img")).toHaveAttribute("src", `/banners/blog/${slug}.webp`);
    // Its Markdown twin moved with it.
    const twin = await page.request.get(`/blog/${slug}/index.md`);
    expect(twin.status()).toBe(200);
    expect((await twin.text()).startsWith(`# ${title}`)).toBe(true);
  });
}

test("the Resources menu and page list the blog, developers, changelog, roadmap, and studio, and no Guides", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const toggle = page.locator(".nav-dropdown-toggle", { hasText: "Resources" });
  await toggle.click();
  const panel = page.locator("#nav-resources");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: /^Guides/ })).toHaveCount(0);
  for (const name of [/^Blog/, /^Developers/, /^Changelog/, /^Roadmap/, /^Rotli Studio/]) {
    await expect(panel.getByRole("link", { name })).toHaveCount(1);
  }
  await page.goto("/resources/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Resources");
  await expect(page.locator("main").getByText("Guides", { exact: true })).toHaveCount(0);
  await expect(page.locator("main .writing-list a[href='/blog/']")).toHaveCount(1);
  await expect(page.locator("main .writing-list a[href='/resources/developers/']")).toHaveCount(1);
});

test("/blog/ filters by Guide and keeps the featured story a post", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/");
  await expect(page.locator("[data-featured] .tag", { hasText: "Guide" })).toHaveCount(0);
  const filters = page.getByRole("group", { name: "Show posts about" });
  await filters.getByRole("button", { name: "Guide" }).click();
  const shown = page.locator("[data-post-list] > li:visible");
  await expect(shown).toHaveCount(Object.keys(GUIDES).length);
  for (const slug of Object.keys(GUIDES)) {
    await expect(page.locator(`[data-post-list] > li:visible a[href="/blog/${slug}/"]`)).toHaveCount(1);
  }
});

test("no page links to an old guide address", async ({ page }) => {
  for (const path of ["/", "/features/", "/download/", "/blog/", "/resources/", "/404.html"]) {
    await page.goto(path);
    const old = await page
      .locator("a[href^='/resources/']")
      .evaluateAll((links) =>
        links
          .map((link) => link.getAttribute("href")!)
          .filter((href) => !/^\/resources\/(developers\/)?$/.test(href)),
      );
    expect(old, path).toEqual([]);
  }
});

test("Rotli Studio is in the Resources menu, the Menu, the page, and the footer, marked as another site", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".nav-dropdown-toggle", { hasText: "Resources" }).click();
  const item = page.locator("#nav-resources").getByRole("link", { name: /^Rotli Studio/ });
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute("href", "https://studio.rotli.co/");
  await expect(item).toHaveAttribute("rel", "noopener");
  await expect(item.locator(".external-mark")).toHaveText("↗");
  // The footer's link says the same thing the same way.
  const footer = page.locator(".footer-groups").getByRole("link", { name: /^Rotli Studio/ });
  await expect(footer).toHaveAttribute("href", "https://studio.rotli.co/");
  await expect(footer.locator(".external-mark")).toHaveText("↗");
  // The narrow Menu.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".nav-menu summary").click();
  await expect(page.locator(".nav-menu-panel").getByRole("link", { name: /^Rotli Studio/ })).toHaveAttribute(
    "href",
    "https://studio.rotli.co/",
  );
  // The /resources/ page, which lists the menu.
  await page.goto("/resources/");
  const entry = page.locator("main .writing-list a[href='https://studio.rotli.co/']");
  await expect(entry).toContainText("Rotli Studio");
  await expect(entry).toContainText("Visit");
});
