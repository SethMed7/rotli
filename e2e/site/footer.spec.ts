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

// WebMCP (2026-10-12): the sign-up is a declarative tool a browser agent can fill in, never send.
test("the sign-up is a WebMCP tool that leaves sending to the person", async ({ page }) => {
  await page.goto("/about/");
  const form = page.locator("[data-subscribe]");
  await expect(form).toHaveAttribute("toolname", "subscribe_to_rotli_updates");
  await expect(form).toHaveAttribute("tooldescription", /the person sends it themselves/);
  await expect(form).not.toHaveAttribute("toolautosubmit");
  await expect(form.getByRole("textbox", { name: "Email address" })).toHaveAttribute(
    "toolparamdescription",
    "The email address to send updates to.",
  );
  await expect(form.locator('input[name="website"]')).toHaveAttribute(
    "toolparamdescription",
    "Always leave this empty.",
  );
});

// WebMCP hands an agent every named control, the spam trap included. Chromium here has no
// WebMCP, so the agent's fill (`:tool-form-active`) is stood in for; a bot's fill still trips it.
for (const agent of [false, true]) {
  test(`a filled spam trap ${agent ? "is dropped when a browser agent filled the form" : "still reaches the server"}`, async ({
    page,
  }) => {
    if (agent) {
      await page.addInitScript(() => {
        Object.defineProperty(HTMLFormElement.prototype, "matches", {
          value(this: HTMLFormElement, selector: string) {
            return selector === ":tool-form-active" || Element.prototype.matches.call(this, selector);
          },
        });
      });
    }
    const posted: Record<string, string>[] = [];
    await page.route("**/api/subscribe", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { live: true } });
      posted.push(route.request().postDataJSON() as Record<string, string>);
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto("/about/");
    await page.waitForLoadState("networkidle");
    const form = page.locator("[data-subscribe]");
    await form.getByRole("textbox", { name: "Email address" }).fill("reader@example.com");
    await form.locator('input[name="website"]').evaluate((trap: HTMLInputElement) => {
      trap.value = "https://example.com";
    });
    await form.getByRole("button", { name: "Keep me posted" }).click();
    await expect(form.getByRole("status")).toHaveText(/You’re on the list\./);
    expect(posted).toEqual([
      agent
        ? { email: "reader@example.com" }
        : { email: "reader@example.com", website: "https://example.com" },
    ]);
  });
}

test("the maker line links to the maker on X", async ({ page }) => {
  await page.goto("/");
  const link = page.locator(".footer-bottom").getByRole("link", { name: "Seth Medina on X" });
  await expect(link).toHaveAttribute("href", "https://x.com/iamsethmedina");
  await expect(link).toHaveAttribute("rel", /\bme\b/);
  const box = (await link.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});
