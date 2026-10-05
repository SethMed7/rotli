// The footer's closing pieces: the "Hear when it's ready" sign-up, which is always there and
// honest when the list is not open yet, and the maker's X mark.
import { expect, test } from "@playwright/test";

test("the sign-up is always there, and says so plainly when the list isn't open", async ({ page }) => {
  // `astro preview` has no sidecar: the probe finds nothing, as on a site with the list off.
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/subscribe")) posts.push(request.url());
  });
  await page.goto("/about/");
  const form = page.locator("[data-subscribe]");
  await expect(form).toBeVisible();
  const email = form.getByRole("textbox", { name: "Email address" });
  await expect(email).toBeVisible();
  await email.fill("reader@example.com");
  await form.getByRole("button", { name: "Keep me posted" }).click();
  await expect(form.getByRole("status")).toHaveText(
    "The list isn’t open yet, so nothing was sent. Check back soon.",
  );
  expect(posts).toEqual([]); // the address never left the browser
  await email.fill("reader2@example.com");
  await expect(form).toHaveAttribute("data-state", "idle");
});

test("with the list open, a sign-up goes through the site's own endpoint", async ({ page }) => {
  await page.route("**/api/subscribe", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { live: true } })
      : route.fulfill({ json: { ok: true } }),
  );
  await page.goto("/about/");
  const form = page.locator("[data-subscribe]");
  await page.waitForLoadState("networkidle");
  await form.getByRole("textbox", { name: "Email address" }).fill("reader@example.com");
  await form.getByRole("button", { name: "Keep me posted" }).click();
  await expect(form.getByRole("status")).toHaveText(/You’re on the list\./);
});

test("the maker line links to the maker on X", async ({ page }) => {
  await page.goto("/");
  const link = page.locator(".footer-bottom").getByRole("link", { name: "Seth Medina on X" });
  await expect(link).toHaveAttribute("href", "https://x.com/iamsethmedina");
  await expect(link).toHaveAttribute("rel", /\bme\b/);
  const box = (await link.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});
