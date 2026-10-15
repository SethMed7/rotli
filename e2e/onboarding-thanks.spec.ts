// Thank you (2026-09-28): after setup, a card thanks the person with a
// banner — their name and quokka in their theme's scenery — and ways to pass
// Rotli on: Share (the share sheet; the browser twin copies the link when it
// has none), and the GitHub and X logos on their own. Then Take the tour, or
// Start now, the primary (closing the card is Start now). Uses the
// development `?onboarding` route.

import { expect, type Page, test } from "@playwright/test";

async function onboardAs(page: Page, name: string) {
  await page.goto("/?onboarding");
  await page.getByPlaceholder("Your first name").fill(name);
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  // the macOS folder panel; the twin picks a fresh empty folder
  await page.getByRole("button", { name: "Choose a folder" }).click();
  // the Librarian, then the shortcuts, then the thank-you card
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();
}

type Shared = { shared?: ShareData[] };

test("setup ends with a thank-you scene and ways to share", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // never reach the real sites from a test
  for (const host of ["https://x.com/**", "https://github.com/**"]) {
    await context.route(host, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }),
    );
  }
  // this browser has no share sheet: Share falls back to the clipboard
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await onboardAs(page, "Ada");

  const card = page.getByRole("dialog", { name: "Thank you for trying Rotli" });
  await expect(card).toBeVisible();
  // the tour waits for the card
  await expect(page.getByRole("region", { name: "Guided tour" })).toHaveCount(0);

  // the banner is a scene: the theme's sky and horizon, the quokka, the words
  const banner = card.getByRole("figure");
  await expect(banner).toContainText("Thank you, Ada");
  await expect(banner).toContainText("for trying Rotli");
  await expect(
    banner.locator(".thanks-banner-quokka .quokka-line, .thanks-banner-quokka .quokka-ink-layer").first(),
  ).toBeAttached({ timeout: 15_000 });
  const box = (await banner.boundingBox())!;
  const horizon = (await banner.locator(".thanks-banner-horizon").boundingBox())!;
  expect(Math.abs(horizon.width - box.width)).toBeLessThanOrEqual(2); // the ground spans the banner, inside its border
  expect(Math.abs(horizon.y + horizon.height - (box.y + box.height))).toBeLessThan(2);

  // no banner to save any more, and no mail-draft invite
  await expect(card.getByRole("button", { name: /banner/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Tell a friend" })).toHaveCount(0);

  // Share: no sheet in this browser, so the line and the link are copied
  await card.getByRole("button", { name: "Share", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("The link to Rotli is copied. Paste it anywhere.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("https://rotli.co");
  expect(copied).not.toContain("Ada");

  // the logos stand alone: labelled, keyboard-focusable, no chip around them
  const x = card.getByRole("button", { name: "Share on X" });
  const star = card.getByRole("button", { name: "Star Rotli on GitHub" });
  await expect(x).toHaveAttribute("title", "Share on X");
  await expect(star).toHaveAttribute("title", "Star Rotli on GitHub");
  for (const logo of [x, star]) {
    await expect(logo).toHaveText("");
    expect(await logo.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("none");
  }
  // keyboard reach: back from X lands on the star, with a visible ring
  await x.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(star).toBeFocused();
  expect(await star.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");

  const post = page.waitForEvent("popup");
  await x.click();
  const intent = new URL((await post).url());
  expect(intent.hostname).toBe("x.com");
  expect(intent.searchParams.get("url")).toBe("https://rotli.co");
  expect(intent.searchParams.get("text")).not.toContain("Ada");

  const github = page.waitForEvent("popup");
  await star.click();
  expect((await github).url()).toBe("https://github.com/SethMed7/rotli");

  // what's next: Take the tour first, Start now last and primary, one line each
  const tourButton = card.getByRole("button", { name: "Take the tour" });
  const startButton = card.getByRole("button", { name: "Start now" });
  const tour = (await tourButton.boundingBox())!;
  const startNow = (await startButton.boundingBox())!;
  expect(tour.x).toBeLessThan(startNow.x);
  expect(Math.abs(startNow.y - tour.y)).toBeLessThan(2);
  expect(startNow.height).toBeLessThan(44);
  expect(tour.height).toBeLessThan(44);
  await expect(startButton).toHaveClass(/primary/);
  await expect(tourButton).not.toHaveClass(/primary/);

  await tourButton.click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Guided tour" })).toBeVisible();
});

test("Share opens the browser's own share sheet where there is one", async ({ page }) => {
  await page.addInitScript(() => {
    const shared: ShareData[] = [];
    (window as Shared).shared = shared;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        shared.push(data);
      },
    });
  });
  await onboardAs(page, "Ada");
  const card = page.getByRole("dialog", { name: "Thank you for trying Rotli" });
  await card.getByRole("button", { name: "Share", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Shared).shared?.[0]?.url)).toBe("https://rotli.co");
  const text = await page.evaluate(() => (window as Shared).shared?.[0]?.text ?? "");
  expect(text).not.toContain("Ada");
  // the sheet speaks for itself
  await expect(card.getByRole("status")).toHaveText("");
});

test("Start now goes straight in: no tour, and the note at Settings at once", async ({ page }) => {
  await onboardAs(page, "");
  const card = page.getByRole("dialog", { name: "Thank you for trying Rotli" });
  await expect(card.getByRole("button", { name: "Take the tour" })).toBeVisible();
  await card.getByRole("button", { name: "Start now" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Guided tour" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "More in Settings" })).toBeVisible();
});

test("Escape closes the card the way Start now does", async ({ page }) => {
  await onboardAs(page, "");
  const card = page.getByRole("dialog", { name: "Thank you for trying Rotli" });
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Guided tour" })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "More in Settings" })).toBeVisible();
});

test("the banner wears their theme, Grove Dark, with the plain quokka setup gives everyone", async ({
  page,
}) => {
  await page.goto("/?onboarding");
  await page.getByPlaceholder("Your first name").fill("Ada");
  await page
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio", { name: /^Grove/ })
    .click();
  await page.getByRole("radio", { name: "Dark", exact: true }).first().click();
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  // the macOS folder panel; the twin picks a fresh empty folder
  await page.getByRole("button", { name: "Choose a folder" }).click();
  // the Librarian, then the shortcuts, then the thank-you card
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Finish setup" }).click();

  const banner = page.getByRole("dialog", { name: "Thank you for trying Rotli" }).getByRole("figure");
  // Grove's own scenery: its gum trees along the horizon
  await expect(banner).toHaveAttribute("data-scenery", "grove");
  await expect(banner.locator(".thanks-banner-horizon .sc-canopy")).toBeAttached();
  const [sky, words] = await banner.evaluate((figure) => {
    const sum = (color: string) =>
      (color.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map(Number)
        .reduce((total, part) => total + part, 0);
    const headline = figure.querySelector(".thanks-banner-headline")!;
    return [sum(getComputedStyle(figure).backgroundColor), sum(getComputedStyle(headline).color)];
  });
  expect(sky).toBeLessThan(200); // a dark sky
  expect(words).toBeGreaterThan(sky + 300); // and words that read on it
  // setup's quokka is plain: no accessory layer
  await expect(banner.locator(".thanks-banner-quokka .quokka-accessory-layer")).toHaveCount(0);
});
