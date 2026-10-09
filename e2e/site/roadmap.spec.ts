import { readFileSync } from "node:fs";

// /roadmap/: the head (words beside the picture, the source link), ROADMAP.md's three public
// sections item for item with each item's status and size, "Recently shipped" read from
// CHANGELOG.md's newest releases, votes (off while the sidecar is: astro preview has none;
// live with the API stubbed: optimistic, kept once per browser, taken back on a refusal,
// keyboard-operable, Ideas ordered by votes), the request form's checks and states, the
// "On this page" nav, and the layout from 320 to 2560 px. The sidecar itself is
// site/server/roadmap.test.ts; the changelog parsing is scripts/site-releases.test.ts.
import { expect, test, type Page, type Route } from "@playwright/test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** The ids under "## N. In the work / Planned / Ideas", read straight from the file, by section. */
function sectionsInFile(): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let open: string | null = null;
  for (const line of read("ROADMAP.md").split("\n")) {
    const heading = /^## \d+\.\s+(.+)$/.exec(line);
    if (heading) {
      const title = heading[1]!.trim();
      open = ["In the work", "Planned", "Ideas"].includes(title) ? title : null;
      if (open) sections[open] = [];
    }
    if (!open) continue;
    for (const match of line.matchAll(/<!-- id: ([a-z0-9-]+) -->/g)) sections[open]!.push(match[1]!);
  }
  return sections;
}
const idsInFile = () => Object.values(sectionsInFile()).flat();

/** The newest four dated releases in CHANGELOG.md and their first three bold leads (Added, Changed, Fixed). */
function releasesInFile() {
  const releases: { version: string; date: string; leads: Record<string, string[]> }[] = [];
  let kind: string | null = null;
  for (const line of read("CHANGELOG.md").split("\n")) {
    const release = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line);
    if (release) {
      if (releases.length === 4) break;
      releases.push({ version: release[1]!, date: release[2]!, leads: {} });
      kind = null;
      continue;
    }
    if (line.startsWith("## ")) continue;
    const heading = /^### (\w+)/.exec(line);
    if (heading) kind = heading[1]!;
    const lead = /^- \*\*(.+?)\*\*/.exec(line);
    if (lead && kind && releases.length > 0) {
      (releases.at(-1)!.leads[kind] ??= []).push(lead[1]!.replace(/[.:]$/, "").replaceAll("`", ""));
    }
  }
  return releases.map(({ version, date, leads }) => ({
    version,
    date,
    items: ["Added", "Changed", "Fixed"].flatMap((name) => leads[name] ?? []).slice(0, 3),
  }));
}

const VOTES = "**/api/roadmap/votes";

async function openLive(page: Page, votes: Record<string, number> = {}) {
  await page.route(VOTES, (route) => route.fulfill({ json: { live: true, votes } }));
  await page.goto("/roadmap/");
  await expect(page.locator("[data-roadmap]")).toHaveAttribute("data-state", "live");
}

test.describe("the page", () => {
  test("carries every item in ROADMAP.md's public sections, once each, in the file's order", async ({
    page,
  }) => {
    await page.goto("/roadmap/");
    const onPage = await page
      .locator("[data-roadmap-item]")
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-roadmap-item")));
    expect(onPage).toEqual(idsInFile());
    for (const name of ["In the work", "Planned", "Ideas", "Recently shipped", "Ask for something"]) {
      await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    }
  });

  test("each item says its status and size beside its title, summary, and vote", async ({ page }) => {
    await page.goto("/roadmap/");
    const status = { "In the work": "In the work", Planned: "Planned", Ideas: "Idea" } as const;
    for (const [section, ids] of Object.entries(sectionsInFile())) {
      for (const id of ids) {
        const item = page.locator(`[data-roadmap-item="${id}"]`);
        await expect(item.locator("h3")).not.toBeEmpty();
        await expect(item.locator(".summary")).not.toBeEmpty();
        await expect(item.locator(".item-meta")).toContainText(status[section as keyof typeof status]);
        await expect(item.locator(`button[data-vote="${id}"]`)).toHaveCount(1);
      }
    }
    // Sizes come from the file, e.g. Sheets (Beta) is L.
    await expect(page.locator('[data-roadmap-item="sheets-beta"] .item-meta')).toContainText("Size L");
    // In the work keeps its drawing; Planned and Ideas are a plain list.
    await expect(page.locator('[data-roadmap-item="sheets-beta"] [data-mock]')).toHaveCount(1);
    await expect(page.locator("[data-list] [data-mock]")).toHaveCount(0);
  });
});

test.describe("the head", () => {
  test("titles the page, says how to take part, and links the roadmap source", async ({ page }) => {
    await page.goto("/roadmap/");
    const head = page.locator("[data-roadmap-head]");
    await expect(head.getByRole("heading", { level: 1 })).toHaveText("What’s next for rotli");
    await expect(head.locator(".lede")).toContainText(
      "Vote for the things you’d use, or ask for something new",
    );
    await expect(head.getByRole("link", { name: "Ask for something" })).toHaveAttribute("href", "#request");
    await expect(head.getByRole("link", { name: "Roadmap source" })).toHaveAttribute(
      "href",
      "https://github.com/SethMed7/rotli/blob/main/ROADMAP.md",
    );
    await expect(head.locator("[data-roadmap-art]")).toBeVisible();
    await expect(head.locator("[data-roadmap-art]")).toHaveAttribute("aria-hidden", "true");
  });

  test("puts the words left and the picture right on a wide screen, and the picture first, across the page, below 1000px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/roadmap/");
    const title = page.locator("[data-roadmap-head] h1");
    const art = page.locator("[data-roadmap-art]");
    let [t, a] = [(await title.boundingBox())!, (await art.boundingBox())!];
    expect(a.x).toBeGreaterThan(t.x + t.width - 1);
    expect(a.y).toBeLessThan(t.y + t.height);
    expect(a.y + a.height).toBeLessThanOrEqual(900);

    // Below 1000px, like a post's head (2026-10-09): the picture first and across the page, the
    // title under it, still in the first window.
    for (const [width, height] of [
      [960, 900],
      [768, 1024],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      [t, a] = [(await title.boundingBox())!, (await art.boundingBox())!];
      const head = (await page.locator("[data-roadmap-head]").boundingBox())!;
      expect(t.y, `title under the picture at ${width}`).toBeGreaterThan(a.y + a.height);
      expect(Math.abs(a.width - head.width), `picture across the page at ${width}`).toBeLessThanOrEqual(1);
      expect(t.y + t.height, `title in the first window at ${width}`).toBeLessThan(height);
    }
  });
});

test.describe("Recently shipped", () => {
  test("shows the newest four releases from CHANGELOG.md with their dates and headline items", async ({
    page,
  }) => {
    await page.goto("/roadmap/");
    const expected = releasesInFile();
    const rows = page.locator("[data-release]");
    await expect(rows).toHaveCount(expected.length);
    for (const [index, release] of expected.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute("data-release", release.version);
      await expect(row.locator("h3")).toHaveText(`rotli ${release.version}`);
      await expect(row.locator("time")).toHaveAttribute("datetime", release.date);
      await expect(row.locator(".what li")).toHaveText(release.items);
    }
  });

  test("links each release to its own heading on the changelog", async ({ page }) => {
    await page.goto("/roadmap/");
    const hrefs = await page
      .locator("[data-release-link]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs).toHaveLength(releasesInFile().length);
    await page.goto("/changelog/");
    for (const href of hrefs) {
      expect(href).toMatch(/^\/changelog\/#/);
      const id = href.split("#")[1]!;
      await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
  });
});

test.describe("votes", () => {
  test("without the sidecar, voting and requests say they open soon and nothing is clickable", async ({
    page,
  }) => {
    await page.goto("/roadmap/");
    await expect(page.locator("[data-roadmap]")).toHaveAttribute("data-state", "off");
    await expect(
      page.getByRole("status").filter({ hasText: "Voting and requests open soon." }),
    ).toBeVisible();
    const votes = page.locator("button[data-vote]");
    expect(await votes.count()).toBe(idsInFile().length);
    for (const button of await votes.all()) await expect(button).toBeDisabled();
    await expect(page.locator("[data-sort]")).toBeHidden();
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

  test("a vote shows at once, takes the sidecar's count, and is remembered by this browser", async ({
    page,
  }) => {
    const [first] = idsInFile();
    const posted: unknown[] = [];
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/roadmap/vote", async (route: Route) => {
      posted.push(route.request().postDataJSON());
      await answered;
      await route.fulfill({ json: { ok: true, counted: true, count: 9 } });
    });
    await openLive(page, { [first!]: 7 });
    await expect(page.locator("[data-roadmap-note]")).toHaveText(
      "Voting is open: one vote per item, remembered by this browser.",
    );

    const button = page.locator(`button[data-vote="${first}"]`);
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button.locator("[data-vote-count]")).toHaveText("7");

    await button.click();
    // Before the sidecar answers: already pressed, counted, and saying so.
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button.locator("[data-vote-count]")).toHaveText("8");
    await expect(button).toContainText("Voted");
    await expect(button).toHaveAttribute("aria-busy", "true");
    release();
    await expect(button).not.toHaveAttribute("aria-busy", "true");
    await expect(button.locator("[data-vote-count]")).toHaveText("9");
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
    await expect(button).toHaveAccessibleName(/^You voted for .*, 7 votes$/);
  });

  test("a refused vote is taken back, and the reason shows beside the item", async ({ page }) => {
    const [first] = idsInFile();
    await page.route("**/api/roadmap/vote", (route) =>
      route.fulfill({
        status: 429,
        json: { ok: false, error: "Too many votes in a row. Give it a few minutes." },
      }),
    );
    await openLive(page, { [first!]: 3 });
    const button = page.locator(`button[data-vote="${first}"]`);
    await button.click();
    await expect(page.locator(`[data-vote-error="${first}"]`)).toHaveText(
      "Too many votes in a row. Give it a few minutes.",
    );
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(button.locator("[data-vote-count]")).toHaveText("3");
    expect(await page.evaluate(() => window.localStorage.getItem("rotli.roadmap.voted"))).toBeNull();
  });

  test("works from the keyboard", async ({ page }) => {
    const ids = sectionsInFile().Planned!;
    await page.route("**/api/roadmap/vote", (route) =>
      route.fulfill({ json: { ok: true, counted: true, count: 1 } }),
    );
    await openLive(page);
    const button = page.locator(`button[data-vote="${ids[0]}"]`);
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const next = page.locator(`button[data-vote="${ids[1]}"]`);
    await next.focus();
    await page.keyboard.press("Space");
    await expect(next).toHaveAttribute("aria-pressed", "true");
  });

  test("Ideas can be ordered by votes while votes are live, and back to the roadmap's order", async ({
    page,
  }) => {
    const ideas = sectionsInFile().Ideas!;
    const votes = { [ideas[5]!]: 12, [ideas[2]!]: 30, [ideas[9]!]: 12 };
    await openLive(page, votes);
    const order = () =>
      page
        .locator('[data-list="ideas"] > li')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-roadmap-item")));
    expect(await order()).toEqual(ideas);
    const most = page.getByRole("button", { name: "Most votes" });
    await most.click();
    await expect(most).toHaveAttribute("aria-pressed", "true");
    const sorted = await order();
    // Most votes first; a tie keeps the file's order; the rest follow in it.
    expect(sorted.slice(0, 3)).toEqual([ideas[2], ideas[5], ideas[9]]);
    expect(sorted.slice(3)).toEqual(ideas.filter((id) => !(id in votes)));
    await page.getByRole("button", { name: "Roadmap order" }).click();
    expect(await order()).toEqual(ideas);
  });
});

test.describe("the request form", () => {
  test("checks each field before sending, then sends once and says thanks", async ({ page }) => {
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
    await expect(page.locator('[data-error-for="email"]')).toBeEmpty();
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(title).toBeFocused();

    await title.fill("Kanban view for tasks");
    await expect(page.locator('[data-error-for="title"]')).toBeEmpty();
    await description.fill("too short");
    await email.fill("not-an-email");
    await send.click();
    await expect(page.locator('[data-error-for="description"]')).toContainText("at least 10 characters");
    await expect(page.locator('[data-error-for="email"]')).toHaveText(
      "That email address does not look right.",
    );
    await expect(description).toBeFocused();
    expect(posted).toHaveLength(0);

    // No email is needed.
    await description.fill("Columns for open, in progress, and done, over the tasks in my notes.");
    await email.fill("");
    await send.click();
    const thanks = page.locator("[data-request-done]");
    await expect(thanks).toBeVisible();
    await expect(thanks).toBeFocused();
    await expect(thanks).toContainText("Thanks. Your request is in.");
    await expect(page.locator("[data-request]")).toBeHidden();
    expect(posted).toEqual([
      {
        title: "Kanban view for tasks",
        description: "Columns for open, in progress, and done, over the tasks in my notes.",
        email: "",
        website: "",
      },
    ]);

    await page.getByRole("link", { name: "Send another" }).click();
    await expect(thanks).toBeHidden();
    await expect(title).toBeVisible();
    await expect(title).toHaveValue("");
    await expect(title).toBeFocused();
  });

  test("says what's kept and links the privacy page's account of it", async ({ page }) => {
    await page.goto("/roadmap/");
    const notes = page.locator(".request-notes");
    for (const words of [
      "an email only if you give one",
      "Railway",
      "Never published",
      "send another request",
    ]) {
      await expect(notes).toContainText(words);
    }
    await expect(notes.getByRole("link", { name: "How the site handles it" })).toHaveAttribute(
      "href",
      "/privacy/#website",
    );
    await expect(page.locator("#request-consent")).toContainText("It isn’t shared or published.");
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
    await expect(page.locator("[data-request]")).toHaveAttribute("data-state", "error");
    await expect(page.getByRole("button", { name: "Send request" })).toBeEnabled();
  });

  test("a request sent without script lands back on the thank-you block", async ({ page }) => {
    await page.goto("/roadmap/#request-sent");
    await expect(page.locator("#request-sent")).toBeVisible();
    await page.goto("/roadmap/");
    await expect(page.locator("#request-sent")).toBeHidden();
  });
});

test.describe("On this page", () => {
  test("on a wide screen it stays in view beside the groups and marks the one being read", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/roadmap/");
    const nav = page.getByRole("navigation", { name: "On this page" });
    const labels = await nav
      .locator("ul a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(labels).toEqual(["#in-the-work", "#planned", "#ideas", "#recently-shipped", "#request"]);
    await nav.getByRole("link", { name: /^Ideas/ }).click();
    await expect(page).toHaveURL(/#ideas$/);
    await expect(nav.getByRole("link", { name: /^Ideas/ })).toHaveAttribute("aria-current", "true");
    const box = (await nav.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(60);
    expect(box.y).toBeLessThan(200);
    // The heading it jumped to sits below the pinned header, not under it.
    const heading = (await page.locator("#ideas-title").boundingBox())!;
    expect(heading.y).toBeGreaterThan(68);
    await nav.getByRole("link", { name: "Ask for something" }).click();
    await expect(nav.getByRole("link", { name: "Ask for something" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("on a phone it is a row of links in the flow, not pinned", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/roadmap/");
    const nav = page.getByRole("navigation", { name: "On this page" });
    expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe("static");
    for (const link of await nav.locator("ul a").all()) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  });
});

test("nothing scrolls sideways from 320 to 2560 px, and phone targets stay finger-sized", async ({
  page,
}) => {
  await page.route(VOTES, (route) => route.fulfill({ json: { live: true, votes: {} } }));
  for (const width of [320, 390, 768, 1024, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/roadmap/");
    await expect(page.locator("[data-roadmap]")).toHaveAttribute("data-state", "live");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${width}px scrolls sideways`).toBe(0);
    const outside = await page
      .locator("main [data-roadmap-item], main [data-release], main form")
      .evaluateAll(
        (els, max) => els.filter((el) => el.getBoundingClientRect().right > max + 0.5).length,
        width,
      );
    expect(outside, `${width}px: something runs off the right edge`).toBe(0);
    if (width <= 390) {
      for (const button of (await page.locator("button[data-vote]").all()).slice(0, 4)) {
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
