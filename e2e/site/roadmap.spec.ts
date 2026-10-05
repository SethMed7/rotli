import { readFileSync } from "node:fs";

// /roadmap/: the page shows ROADMAP.md's three public sections item for item, says
// voting and requests "open soon" while the sidecar is off (astro preview has none),
// counts a vote once per browser, and checks a request before it is sent. The API is
// stubbed with Playwright routes; the sidecar itself is site/server/roadmap.test.ts.
import { expect, test, type Page, type Route } from "@playwright/test";

/** The ids under "## N. In the work / Planned / Ideas", read straight from the file. */
function idsInFile(): string[] {
  const text = readFileSync(new URL("../../ROADMAP.md", import.meta.url), "utf8");
  const ids: string[] = [];
  let open = false;
  for (const line of text.split("\n")) {
    const heading = /^## \d+\.\s+(.+)$/.exec(line);
    if (heading) open = ["In the work", "Planned", "Ideas"].includes(heading[1]!.trim());
    if (!open) continue;
    for (const match of line.matchAll(/<!-- id: ([a-z0-9-]+) -->/g)) ids.push(match[1]!);
  }
  return ids;
}

const VOTES = "**/api/roadmap/votes";

async function openLive(page: Page, votes: Record<string, number> = {}) {
  await page.route(VOTES, (route) => route.fulfill({ json: { live: true, votes } }));
  await page.goto("/roadmap/");
}

test("the page carries every item in ROADMAP.md's public sections, once each", async ({ page }) => {
  await page.goto("/roadmap/");
  const onPage = await page
    .locator("[data-roadmap-item]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-roadmap-item")));
  expect(onPage).toEqual(idsInFile());
  for (const name of ["In the work", "Planned", "Ideas", "Ask for something"]) {
    await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  }
});

test("without the sidecar, voting and requests say they open soon and nothing is clickable", async ({
  page,
}) => {
  await page.goto("/roadmap/");
  await expect(page.locator("[data-roadmap]")).toHaveAttribute("data-state", "off");
  await expect(page.getByRole("status").filter({ hasText: "Voting and requests open soon." })).toBeVisible();
  const votes = page.locator("button[data-vote]");
  expect(await votes.count()).toBe(idsInFile().length);
  for (const button of await votes.all()) await expect(button).toBeDisabled();
  await expect(page.getByLabel("What should rotli do?")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send request" })).toBeDisabled();
  await expect(page.locator("[data-request-status]")).toHaveText("Requests open soon.");
});

test("a 503 from the sidecar reads the same as no sidecar", async ({ page }) => {
  await page.route(VOTES, (route) => route.fulfill({ status: 503, body: "This is not open right now." }));
  await page.goto("/roadmap/");
  await expect(page.locator("[data-roadmap]")).toHaveAttribute("data-state", "off");
  await expect(page.locator("button[data-vote]").first()).toBeDisabled();
});

test("a vote counts once, shows the new count, and is remembered by this browser", async ({ page }) => {
  const [first] = idsInFile();
  const posted: unknown[] = [];
  await page.route("**/api/roadmap/vote", async (route: Route) => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, counted: true, count: 8 } });
  });
  await openLive(page, { [first!]: 7 });

  const button = page.locator(`button[data-vote="${first}"]`);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button.locator("[data-vote-count]")).toHaveText("7");
  await expect(page.locator("[data-roadmap-note]")).toBeHidden();

  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button.locator("[data-vote-count]")).toHaveText("8");
  await expect(button).toContainText("Voted");
  expect(posted).toEqual([{ id: first }]);

  // A second click does nothing: one vote per item per browser.
  await button.click();
  expect(posted).toHaveLength(1);
  expect(await page.evaluate(() => window.localStorage.getItem("rotli.roadmap.voted"))).toBe(
    JSON.stringify([first]),
  );

  // Back on the page later, the vote is still marked as this browser's.
  await page.reload();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAccessibleName(/^You voted for /);
});

test("a vote that fails says so and can be tried again", async ({ page }) => {
  const [first] = idsInFile();
  await page.route("**/api/roadmap/vote", (route) =>
    route.fulfill({
      status: 429,
      json: { ok: false, error: "Too many votes in a row. Give it a few minutes." },
    }),
  );
  await openLive(page);
  const button = page.locator(`button[data-vote="${first}"]`);
  await button.click();
  await expect(page.locator("[data-roadmap-note]")).toHaveText(
    "Too many votes in a row. Give it a few minutes.",
  );
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.localStorage.getItem("rotli.roadmap.voted"))).toBeNull();
});

test("the request form checks each field before sending, then sends once", async ({ page }) => {
  const posted: Record<string, string>[] = [];
  await page.route("**/api/roadmap/request", async (route) => {
    posted.push(route.request().postDataJSON() as Record<string, string>);
    await route.fulfill({ json: { ok: true } });
  });
  await openLive(page);
  const title = page.getByLabel("What should rotli do?");
  const description = page.getByLabel("Tell us more");
  const email = page.getByLabel("Email (optional)");
  const send = page.getByRole("button", { name: "Send request" });

  await send.click();
  await expect(page.locator('[data-error-for="title"]')).toHaveText("Give it a short title.");
  await expect(page.locator('[data-error-for="description"]')).toHaveText("Say a little more about it.");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(title).toBeFocused();

  await title.fill("Kanban view for tasks");
  await description.fill("too short");
  await email.fill("not-an-email");
  await send.click();
  await expect(page.locator('[data-error-for="title"]')).toBeEmpty();
  await expect(page.locator('[data-error-for="description"]')).toContainText("at least 10 characters");
  await expect(page.locator('[data-error-for="email"]')).toHaveText(
    "That email address does not look right.",
  );
  await expect(description).toBeFocused();
  expect(posted).toHaveLength(0);

  await description.fill("Columns for open, in progress, and done, over the tasks in my notes.");
  await email.fill("ada@example.com");
  await send.click();
  await expect(page.locator("[data-request-status]")).toHaveText("Thanks. Your request is in.");
  expect(posted).toEqual([
    {
      title: "Kanban view for tasks",
      description: "Columns for open, in progress, and done, over the tasks in my notes.",
      email: "ada@example.com",
      website: "",
    },
  ]);
  await expect(title).toHaveValue("");
});

test("a request the sidecar refuses marks the field it names", async ({ page }) => {
  await page.route("**/api/roadmap/request", (route) =>
    route.fulfill({
      status: 400,
      json: { ok: false, field: "title", error: "Give it a short title (3 to 120 characters)." },
    }),
  );
  await openLive(page);
  await page.getByLabel("What should rotli do?").fill("Okay title");
  await page.getByLabel("Tell us more").fill("A long enough description of the request.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator('[data-error-for="title"]')).toHaveText(
    "Give it a short title (3 to 120 characters).",
  );
  await expect(page.locator("[data-request-status]")).toHaveText(
    "Give it a short title (3 to 120 characters).",
  );
});

test("a request sent without script lands back on a thank-you line", async ({ page }) => {
  await page.goto("/roadmap/#request-sent");
  await expect(page.locator("#request-sent")).toBeVisible();
  await page.goto("/roadmap/");
  await expect(page.locator("#request-sent")).toBeHidden();
});
