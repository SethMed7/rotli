// Thank you (2026-09-28): after setup, a card thanks the person and shows a
// banner drawn from their own choices, with a GitHub star, an invite, Share on
// X (a fixed caption; the banner goes on the clipboard), and a download.
// Closing it starts the guided tour. Uses the development `?onboarding` route.

import { expect, type Page, test } from "@playwright/test";

async function onboardAs(page: Page, name: string) {
  await page.goto("/?onboarding");
  await page.getByPlaceholder("Your first name").fill(name);
  await page.getByRole("button", { name: "Skip app setup" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Thanks Practice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Use empty folder", exact: true }).click();
  await page.getByRole("button", { name: /^Create vault/ }).click();
  await page.getByRole("button", { name: "Skip model setup" }).click();
}

test("setup ends with a thank-you card, a banner of their own, and ways to share", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // never reach the real sites from a test
  for (const host of ["https://x.com/**", "https://github.com/**"]) {
    await context.route(host, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>stub</title>" }),
    );
  }
  await onboardAs(page, "Ada");

  const card = page.getByRole("dialog", { name: "Thank you for trying Rotli" });
  await expect(card).toBeVisible();
  // the tour waits for the card
  await expect(page.getByRole("region", { name: "Guided tour" })).toHaveCount(0);

  const banner = card.getByRole("img", { name: "Your Rotli welcome banner" });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const drawn = await banner.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    // how much of the quokka's square differs from the ground in the corner
    const ground = ctx.getImageData(4, 4, 1, 1).data;
    const quokka = ctx.getImageData(110, 110, 440, 440).data;
    let inked = 0;
    for (let index = 0; index < quokka.length; index += 4) {
      const delta =
        Math.abs(quokka[index]! - ground[0]!) +
        Math.abs(quokka[index + 1]! - ground[1]!) +
        Math.abs(quokka[index + 2]! - ground[2]!);
      if (delta > 120) inked += 1;
    }
    return { width: image.naturalWidth, height: image.naturalHeight, inked: inked / (440 * 440) };
  });
  expect(drawn.width).toBe(1200);
  expect(drawn.height).toBe(630);
  expect(drawn.inked).toBeGreaterThan(0.02); // the quokka's line work is really there

  // Share on X: fixed caption and the site, the banner on the clipboard
  const popup = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Share on X" }).click();
  const post = new URL((await popup).url());
  expect(post.hostname).toBe("x.com");
  expect(post.searchParams.get("url")).toBe("https://rotli.co");
  expect(post.searchParams.get("text")).not.toContain("Ada");
  await expect(card.getByRole("status")).toHaveText("Your banner is copied. Paste it into the post with ⌘V.");
  const clip = await page.evaluate(async () => (await navigator.clipboard.read())[0]?.types ?? []);
  expect(clip).toContain("image/png");

  await card.getByRole("button", { name: "Tell a friend" }).click();
  await expect(card.getByRole("status")).toHaveText("An invite is copied. Send it to a friend.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("https://rotli.co");

  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: "Download banner" }).click();
  expect((await download).suggestedFilename()).toBe("rotli-welcome.png");

  const star = page.waitForEvent("popup");
  await card.getByRole("button", { name: "Star on GitHub" }).click();
  expect((await star).url()).toBe("https://github.com/SethMed7/rotli");

  await card.getByRole("button", { name: "Take the tour" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Guided tour" })).toBeVisible();
});

test("Escape closes the card and still starts the tour", async ({ page }) => {
  await onboardAs(page, "");
  const card = page.getByRole("dialog", { name: "Thank you for trying Rotli" });
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Guided tour" })).toBeVisible();
});

test("the banner wears their choices: a Grove Dark ground and the bucket hat they picked", async ({
  page,
}) => {
  await page.goto("/?onboarding");
  await page.getByPlaceholder("Your first name").fill("Ada");
  await page.getByRole("button", { name: "Get started" }).click();
  await page
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio", { name: /^Grove/ })
    .click();
  await page.getByRole("radio", { name: "Dark", exact: true }).first().click();
  await page.getByRole("checkbox", { name: "Keep my quokka throughout Rotli" }).check();
  await page
    .getByRole("radiogroup", { name: "Accessory" })
    .getByRole("radio", { name: /^Bucket hat/ })
    .click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Choose where notes live" }).click();
  await page.getByRole("button", { name: "Choose an empty folder" }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("New folder name").fill("Hat Practice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "Use empty folder", exact: true }).click();
  await page.getByRole("button", { name: /^Create vault/ }).click();
  await page.getByRole("button", { name: "Skip model setup" }).click();

  const banner = page
    .getByRole("dialog", { name: "Thank you for trying Rotli" })
    .getByRole("img", { name: "Your Rotli welcome banner" });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  const [ground, crown] = await banner.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    return [pixel(4, 4), pixel(330, 170)]; // a corner, and the hat's crown over the quokka's head
  });
  expect(ground[0]! + ground[1]! + ground[2]!).toBeLessThan(150); // a dark ground
  expect(crown[0]!).toBeGreaterThan(crown[1]! + 40); // the warm hat, not the green quokka or ground
});
