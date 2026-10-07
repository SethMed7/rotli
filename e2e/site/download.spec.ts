// /download/: the two ways in (the Mac app and Rotli Web) as panels, led by the visitor's own
// system; Windows and Linux as "Coming soon" with Rotli Web for the meantime; the dock scene
// that plays once and holds still under reduced motion; and nothing overlapping from 320 to
// 1920. This suite's build may leave Rotli Web off (playwright.site.config.ts sets no
// WEB_APP_ENABLED), so every Rotli Web assertion is conditional, and the page must make sense
// both ways.
import { expect, test, type Browser, type Page } from "@playwright/test";

const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

async function open(browser: Browser, os: keyof typeof UA, options: { javaScriptEnabled?: boolean } = {}) {
  const context = await browser.newContext({ userAgent: UA[os], ...options });
  const page = await context.newPage();
  await page.goto("/download/");
  return { context, page };
}

const hasWeb = async (page: Page) => (await page.locator(".choice-web").count()) > 0;

test("a Mac leads with the Mac download, marked for this Mac", async ({ browser }) => {
  const { context, page } = await open(browser, "mac");
  await expect(page.locator("html")).toHaveAttribute("data-os", "mac");
  const lead = page.locator(".lead-mac");
  await expect(lead).toBeVisible();
  await expect(lead.getByRole("link", { name: "Download for Mac" })).toHaveAttribute("href", /Rotli\.dmg$/);
  await expect(lead).toContainText("Apple silicon · macOS 11 or later");
  await expect(page.locator(".lead-windows")).toBeHidden();
  const mac = page.locator(".choice-mac");
  await expect(mac.locator(".fit")).toHaveText("For this Mac");
  await expect(mac.getByRole("link", { name: "Download .dmg" })).toHaveAttribute("href", /Rotli\.dmg$/);
  await expect(mac.getByRole("link", { name: "Release notes and older versions" })).toBeVisible();
  if (await hasWeb(page)) {
    const [macBox, webBox] = await Promise.all([
      mac.boundingBox(),
      page.locator(".choice-web").boundingBox(),
    ]);
    expect(macBox!.x).toBeLessThan(webBox!.x);
    await expect(page.locator(".choice-web .fit")).toBeHidden();
  }
  await context.close();
});

for (const [os, name] of [
  ["windows", "Windows"],
  ["linux", "Linux"],
] as const) {
  test(`a ${name} visitor is told the app is coming soon and offered no DMG first`, async ({ browser }) => {
    const { context, page } = await open(browser, os);
    await expect(page.locator("html")).toHaveAttribute("data-os", os);
    const lead = page.locator(`.lead-${os}`);
    await expect(lead).toBeVisible();
    await expect(lead.locator(".lead-title")).toHaveText(`rotli for ${name} is coming soon`);
    await expect(lead.locator("a[href$='.dmg']")).toHaveCount(0);
    await expect(page.locator(".lead-mac")).toBeHidden();
    if (await hasWeb(page)) {
      await expect(lead.getByRole("link", { name: "Open Rotli Web" })).toHaveAttribute("href", "/app/");
      await expect(lead).toContainText("Use Rotli Web in the meantime");
      // Rotli Web is the first panel, marked for this computer; the Mac panel follows.
      const [web, mac] = await Promise.all([
        page.locator(".choice-web").boundingBox(),
        page.locator(".choice-mac").boundingBox(),
      ]);
      expect(web!.x).toBeLessThan(mac!.x);
      await expect(page.locator(".choice-web .fit")).toHaveText("For this computer");
    } else {
      await expect(lead.getByRole("link", { name: "Follow it on the roadmap" })).toHaveAttribute(
        "href",
        "/roadmap/",
      );
    }
    await expect(page.locator(".choice-mac .fit")).toBeHidden();
    await expect(page.locator(`.soon-${os} .you`)).toBeVisible();
    await context.close();
  });
}

test("a phone is told rotli runs on a computer", async ({ browser }) => {
  const { context, page } = await open(browser, "iphone");
  await expect(page.locator("html")).toHaveAttribute("data-os", "mobile");
  await expect(page.locator(".lead-elsewhere")).toBeVisible();
  await expect(page.locator(".lead-elsewhere")).toContainText("aren’t supported yet");
  await expect(page.locator(".lead-mac")).toBeHidden();
  await context.close();
});

test("without script the Mac leads", async ({ browser }) => {
  const { context, page } = await open(browser, "windows", { javaScriptEnabled: false });
  await expect(page.locator("html")).not.toHaveAttribute("data-os", /.+/);
  await expect(page.locator(".lead-mac")).toBeVisible();
  await expect(page.locator(".lead-windows")).toBeHidden();
  await expect(page.locator(".choice-mac .fit")).toBeVisible();
  await context.close();
});

test("Windows and Linux are coming soon, with the roadmap and the sign-up a click away", async ({ page }) => {
  await page.goto("/download/");
  const soon = page.locator(".soon");
  for (const name of ["Windows", "Linux"]) {
    const item = soon.locator(".soon-item", {
      has: page.getByRole("heading", { name: new RegExp(`^${name}`) }),
    });
    await expect(item.locator(".status")).toHaveText("Coming soon");
    await expect(item.locator("a[href$='.dmg']")).toHaveCount(0);
    if (await hasWeb(page))
      await expect(item.getByRole("link")).toContainText("Use Rotli Web in the meantime");
  }
  await expect(soon.getByRole("link", { name: "Follow them on the roadmap" })).toHaveAttribute(
    "href",
    "/roadmap/",
  );
  const signup = soon.getByRole("link", { name: "Hear when they’re ready" });
  await expect(signup).toHaveAttribute("href", "#subscribe-title");
  await expect(page.locator("#subscribe-title")).toHaveCount(1);
});

test("the page says what you get, the first steps, and answers questions", async ({ page }) => {
  await page.goto("/download/");
  await expect(page.locator(".get-list li")).toHaveCount(4);
  await expect(page.locator(".get-list")).toContainText("Docs and Sheets (beta)");
  await expect(page.locator(".step-list li")).toHaveCount(4);
  await expect(page.locator(".step-list")).toContainText("drag rotli into Applications");
  const question = page.locator(".faq-list details", { hasText: "Which Macs does it run on?" });
  await question.locator("summary").click();
  await expect(question.locator("p")).toContainText("Apple silicon");
  // One page links the DMG, and its JSON-LD is the app's alone (no second FAQPage).
  const types = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent ?? "").join(" "));
  expect(types).toContain("SoftwareApplication");
  expect(types).not.toContain("FAQPage");
});

test("the dock scene plays once, and holds still under reduced motion", async ({ browser }) => {
  const moving = await browser.newContext({ userAgent: UA.mac });
  const page = await moving.newPage();
  await page.goto("/download/");
  const scene = page.locator(".dscene");
  await expect(scene).toHaveClass(/is-visible/);
  // It finishes and rests: nothing loops.
  await expect
    .poll(
      () =>
        scene.evaluate(
          (el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
        ),
      {
        timeout: 6000,
      },
    )
    .toBe(0);
  await moving.close();

  const calm = await browser.newContext({ userAgent: UA.mac, reducedMotion: "reduce" });
  const still = await calm.newPage();
  await still.goto("/download/");
  const count = await still
    .locator(".dscene")
    .evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length);
  expect(count).toBe(0);
  await calm.close();
});

const intersects = (a: DOMRect, b: DOMRect) =>
  a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

for (const width of [320, 390, 768, 1024, 1440, 1920]) {
  test(`nothing overlaps on the download page at ${width}px`, async ({ browser }) => {
    for (const os of ["mac", "windows"] as const) {
      const context = await browser.newContext({
        userAgent: UA[os],
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.goto("/download/");
      const groups = await page.evaluate(() => {
        const box = (el: Element) => el.getBoundingClientRect().toJSON() as DOMRect;
        const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
        const kids = (selector: string) => [...document.querySelectorAll(selector)].filter(visible).map(box);
        return [
          [...document.querySelectorAll(".get-head > *")].filter(visible).map(box),
          kids(".choices > *"),
          kids(".soon > *"),
          kids(".soon-list > *"),
          kids(".get-list > *"),
          kids(".step-list > *"),
          [...document.querySelectorAll(".lead")]
            .filter(visible)
            .flatMap((lead) => [...lead.children].map(box)),
        ];
      });
      for (const group of groups) {
        for (let i = 0; i < group.length; i++)
          for (let j = i + 1; j < group.length; j++) expect(intersects(group[i]!, group[j]!)).toBe(false);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await context.close();
    }
  });
}
