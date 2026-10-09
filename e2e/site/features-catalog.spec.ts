// /features/ as a catalog (site/src/features.ts): every capability a tile grouped by area, a
// search box and area chips that filter in place and live in the address, a page per
// capability that can be linked straight to, keyboard use, the plain grouped list without
// script, and one column on a phone. Since 2026-10-06: a header picture, bare icons with no box,
// one plain availability line ("Available on Mac"), and a condensed list whose retired ids
// redirect to their section on the surviving page. Since 2026-10-07: each area tab shows how many
// it holds (following the search), and the catalog closes on a banner to the roadmap. This suite's build has WEB_APP_ENABLED off,
// so the Rotli Web tile is absent and every line names the Mac only; nothing here assumes Web.
import { expect, test } from "@playwright/test";

const tiles = (page: import("@playwright/test").Page) => page.locator("[data-feature]");
const visibleTiles = (page: import("@playwright/test").Page) => page.locator("[data-feature]:visible");

test("every capability is a tile that links to its own page, grouped by area", async ({ page }) => {
  await page.goto("/features/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Everything rotli does, in plain files.");
  const count = await tiles(page).count();
  // Condensed on 2026-10-06 from about thirty entries.
  expect(count).toBeGreaterThanOrEqual(14);
  expect(count).toBeLessThanOrEqual(20);
  for (const tile of await tiles(page).all()) {
    const id = await tile.getAttribute("data-feature");
    await expect(tile.locator("a")).toHaveAttribute("href", `/features/${id}/`);
    await expect(tile.locator(".availability")).toHaveText(
      /^(Available on Mac|Beta on Mac|Coming soon to Mac)$/,
    );
  }
  await expect(page.locator(".area h2")).toHaveText([
    "Writing",
    "Organizing",
    "AI and chat",
    "Files",
    "Privacy and control",
    "Rotli Web and agents",
  ]);
  // Docs and Sheets say Beta; the next release's items say Coming soon; no word stands alone.
  await expect(page.locator('[data-feature="docs"] .availability')).toHaveText("Beta on Mac");
  await expect(page.locator('[data-feature="charts"] .availability')).toHaveText("Coming soon to Mac");
  await expect(page.locator('[data-feature="markdown"] .availability')).toHaveText("Available on Mac");
  await expect(page.locator("[data-feature] .status")).toHaveCount(0);
  await expect(page.locator('[data-feature="rotli-web"]')).toHaveCount(0);
  await expect(page.locator("[data-catalog-count]")).toHaveText(`${count} features`);
});

test("an area chip filters the catalog and stays in the address", async ({ page }) => {
  await page.goto("/features/");
  const all = await tiles(page).count();
  const chip = page.getByRole("button", { name: "AI and chat" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  await expect(page).toHaveURL(/\?area=ai$/);
  const shown = await visibleTiles(page).count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(all);
  for (const tile of await visibleTiles(page).all()) await expect(tile).toHaveAttribute("data-area", "ai");
  await expect(page.locator("#writing")).toBeHidden();
  await expect(page.locator("[data-catalog-count]")).toHaveText(`${shown} features in AI and chat`);
  // The pressed chip again shows everything.
  await chip.click();
  await expect(visibleTiles(page)).toHaveCount(all);
  await expect(page).toHaveURL(/\/features\/$/);
});

test("search narrows the catalog, and says so when nothing matches", async ({ page }) => {
  await page.goto("/features/");
  const all = await tiles(page).count();
  const search = page.getByRole("searchbox", { name: "Search features" });
  await search.fill("excalidraw");
  await expect(visibleTiles(page)).toHaveCount(1);
  await expect(visibleTiles(page)).toHaveAttribute("data-feature", "boards");
  await expect(page).toHaveURL(/\?q=excalidraw$/);
  await search.fill("zzzz nothing");
  await expect(visibleTiles(page)).toHaveCount(0);
  await expect(page.locator("[data-catalog-empty]")).toBeVisible();
  await page.getByRole("button", { name: "Show every feature" }).click();
  await expect(visibleTiles(page)).toHaveCount(all);
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  // Escape clears the box too.
  await search.fill("chat");
  await search.press("Escape");
  await expect(visibleTiles(page)).toHaveCount(all);
});

test("each tab counts what the search leaves in its area", async ({ page }) => {
  await page.goto("/features/");
  const all = await tiles(page).count();
  const tally = (area: string) => page.locator(`[data-tally="${area}"]`);
  await expect(tally("")).toHaveText(String(all));
  const files = await page.locator('[data-catalog-area="files"] [data-feature]').count();
  await expect(tally("files")).toHaveText(String(files));
  await page.getByRole("searchbox", { name: "Search features" }).fill("excalidraw");
  await expect(tally("")).toHaveText("1");
  await expect(tally("files")).toHaveText("1");
  await expect(tally("writing")).toHaveText("0");
  // The number is decoration; the tab's name stays the area's name alone.
  await expect(page.getByRole("button", { name: "Files", exact: true })).toBeVisible();
});

test("the catalog closes on a banner to the roadmap", async ({ page }) => {
  await page.goto("/features/");
  const banner = page.getByRole("region", { name: /what comes next/i });
  // "Vote for it" while voting is open (site/src/roadmap.ts VOTING_OPEN); off, "See it".
  await expect(banner.getByRole("heading", { level: 2 })).toContainText(/(Vote for|See) it on the roadmap\./);
  await banner.getByRole("link", { name: "See the roadmap" }).click();
  await expect(page).toHaveURL(/\/roadmap\/$/);
});

test("a filtered catalog can be linked, and Back from a feature returns to it", async ({ page }) => {
  await page.goto("/features/?area=files");
  await expect(page.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true");
  for (const tile of await visibleTiles(page).all()) await expect(tile).toHaveAttribute("data-area", "files");
  await page.locator('[data-feature="boards"] a').click();
  await expect(page).toHaveURL(/\/features\/boards\/$/);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#writing")).toBeHidden();
});

test("a feature's page stands on its own: status, picture, how to use it, and the rest of its area", async ({
  page,
}) => {
  await page.goto("/features/boards/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Boards and pictures");
  await expect(page.locator(".crumbs a")).toHaveText(["Features", "Files"]);
  await expect(page.locator(".crumbs a").nth(1)).toHaveAttribute("href", "/features/?area=files#files");
  await expect(page.locator(".head .availability")).toHaveText("Available on Mac");
  await expect(page.getByRole("img", { name: /Excalidraw board/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it does" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How to use it" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "More in Files" })).toBeVisible();
  await expect(page.locator(".rest [data-feature]")).not.toHaveCount(0);
  await expect(page.locator('.rest [data-feature="boards"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/features\/boards\/$/);
  // What it took in is a section of its own, under its old id.
  await expect(page.getByRole("heading", { level: 2, name: "Pictures and files" })).toBeVisible();
  await expect(page.locator("section#pictures-and-files")).toHaveCount(1);
  // Something not out yet says so, and where it is coming.
  await page.goto("/features/charts/");
  await expect(page.locator(".head .availability")).toHaveText("Coming soon to Mac");
  await expect(page.getByRole("heading", { name: "How it will work" })).toBeVisible();
});

test("a merged page keeps every part it took in, each with its picture and keys", async ({ page }) => {
  await page.goto("/features/markdown/");
  for (const [id, title] of [
    ["tables-code-math", "Tables, code, and math"],
    ["diagrams", "Mermaid diagrams"],
  ] as const) {
    const part = page.locator(`section#${id}`);
    await expect(part.getByRole("heading", { level: 2 })).toHaveText(title);
    await expect(part.locator("img")).toBeVisible();
    await expect(part.locator("kbd")).not.toHaveCount(0);
  }
  await expect(page.getByRole("img", { name: /flowchart from Capture to Note to Library/ })).toBeVisible();
});

// The ids folded into another on 2026-10-06 (src/features.ts movedFrom). rotli-helper's page is
// Rotli Web's, which this build (WEB_APP_ENABLED off) doesn't have, so it isn't written here.
const FOLDED: [string, string, string][] = [
  ["tables-code-math", "markdown", "Tables, code, and math"],
  ["diagrams", "markdown", "Mermaid diagrams"],
  ["links", "search", "Links between notes"],
  ["slash-commands", "templates", "Slash commands"],
  ["panes-and-keys", "make-it-yours", "Panes, tabs, and your own keys"],
  ["ask-the-librarian", "librarian", "Talk to the Librarian"],
  ["on-device-ai", "connected-ai", "AI on your Mac"],
  ["sheets", "docs", "Excel workbooks"],
  ["pictures-and-files", "boards", "Pictures and files"],
  ["open-a-folder", "your-folder", "Bring the folder you have"],
  ["what-ai-may-change", "secure-notes", "What AI may change"],
];

for (const [old, home, title] of FOLDED) {
  test(`/features/${old}/ redirects to its section on /features/${home}/`, async ({ page }) => {
    await page.goto(`/features/${old}/`);
    await page.waitForURL(`**/features/${home}/#${old}`);
    const heading = page.locator(`section#${old} h2`);
    await expect(heading).toHaveText(title);
    await expect(heading).toBeInViewport();
  });
}

test("/features/themes/ redirects to Make it yours, whose words it now leads", async ({ page }) => {
  await page.goto("/features/themes/");
  await page.waitForURL("**/features/make-it-yours/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Make it yours");
  await expect(page.locator(".what")).toContainText("Paper & Charcoal");
});

test("no page links a retired feature address", async ({ page }) => {
  const retired = new RegExp(
    `^/features/(${[...FOLDED.map(([old]) => old), "themes", "rotli-helper"].join("|")})/`,
  );
  let seen = 0;
  for (const path of ["/", "/features/", "/features/markdown/", "/privacy/", "/download/", "/llms.txt"]) {
    const response = await page.request.get(path);
    const hrefs = [
      ...(await response.text()).matchAll(/(?:href="|\]\()(?:https?:\/\/[^/"]+)?(\/features\/[^"#)]+)/g),
    ].map((match) => match[1]!);
    seen += hrefs.length;
    for (const href of hrefs) expect(href, `${path} links ${href}`).not.toMatch(retired);
  }
  // The pages do link features (the catalog, its pages, llms.txt), so the check has teeth.
  expect(seen).toBeGreaterThan(20);
});

test("tiles show a bare icon in the ink, level with the name, and no box around anything", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/features/");
  const tile = page.locator('[data-feature="markdown"]');
  const icon = tile.locator(".icon");
  const look = await icon.evaluate((svg) => {
    const style = getComputedStyle(svg);
    const parent = getComputedStyle(svg.parentElement!);
    return {
      tag: svg.tagName.toLowerCase(),
      parentTag: svg.parentElement!.tagName.toLowerCase(),
      border: style.borderTopWidth,
      background: style.backgroundColor,
      color: style.color,
      text: getComputedStyle(document.body).color,
      parentBorder: parent.borderTopWidth,
    };
  });
  // The svg sits straight in the link: no wrapper square, no border, no fill behind it.
  expect(look.tag).toBe("svg");
  expect(look.parentTag).toBe("a");
  expect(look.border).toBe("0px");
  expect(look.background).toBe("rgba(0, 0, 0, 0)");
  expect(look.color).toBe(look.text);
  // Level with the name's first line.
  const iconBox = (await icon.boundingBox())!;
  const nameBox = (await tile.locator(".name").boundingBox())!;
  const lineHeight = await tile
    .locator(".name")
    .evaluate((name) => parseFloat(getComputedStyle(name).lineHeight));
  expect(Math.abs(iconBox.y + iconBox.height / 2 - (nameBox.y + lineHeight / 2))).toBeLessThanOrEqual(3);
  // Hover doesn't paint the tile into a card.
  await tile.locator("a").hover();
  await expect(tile.locator("a")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(tile.locator(".name")).toHaveCSS("text-decoration-line", "underline");
});

for (const width of [390, 768, 1440, 1920]) {
  test(`the header shows the quokka at its desk among the app's windows (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/features/");
    const scene = page.locator("[data-features-scene]");
    await expect(scene).toBeVisible();
    await expect(scene.locator(".fscene")).toHaveAttribute("aria-hidden", "true");
    // Every picture in it is a local webp, loaded.
    const images = await scene.locator("img:visible").evaluateAll((items) =>
      (items as HTMLImageElement[]).map((img) => ({
        src: img.getAttribute("src")!,
        loaded: img.complete && img.naturalWidth > 0,
      })),
    );
    expect(images.length).toBeGreaterThanOrEqual(1);
    for (const image of images) {
      expect(image.src).toMatch(/^\/[^/].*\.webp$/);
      expect(image.loaded, image.src).toBe(true);
    }
    await expect(scene.locator(".quokka")).toBeVisible();
    await expect(scene.locator(".note")).toBeVisible();
    await expect(scene.locator(".chat")).toBeVisible();
    // Its words stay readable: nothing in it under 10px.
    const smallest = await scene.evaluate((root) =>
      Math.min(...[...root.querySelectorAll("p, li")].map((el) => parseFloat(getComputedStyle(el).fontSize))),
    );
    expect(smallest).toBeGreaterThanOrEqual(10);
    // It stays inside the page and its column, and the headline stays clear of it.
    const box = (await scene.boundingBox())!;
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(clientWidth);
    const h1 = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const apart = h1.x + h1.width <= box.x + 1 || h1.y + h1.height <= box.y + 1;
    expect(apart).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(
      0,
    );
  });
}

test("the catalog works from the keyboard", async ({ page }) => {
  await page.goto("/features/");
  const chip = page.getByRole("button", { name: "Organizing" });
  await chip.focus();
  await page.keyboard.press("Space");
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  const link = page.locator('[data-feature="librarian"] a');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/features\/librarian\/$/);
});

test.describe("without script", () => {
  test.use({ javaScriptEnabled: false });

  test("the catalog is the complete grouped list, with jump links instead of filters", async ({ page }) => {
    await page.goto("/features/");
    await expect(page.locator("[data-catalog-tools]")).toBeHidden();
    await expect(page.locator(".jump a")).toHaveCount(6);
    await expect(page.locator(".jump a").first()).toHaveAttribute("href", "#writing");
    const all = await tiles(page).count();
    await expect(visibleTiles(page)).toHaveCount(all);
    await page.locator('[data-feature="chat"] a').click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chat with your notes");
  });
});

test("on a phone the tiles are one column and the chips wrap inside the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/features/");
  const lefts = await page
    .locator("#writing [data-feature]")
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().left)));
  expect(new Set(lefts).size).toBe(1);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (const chip of await page.locator("[data-chip]").all()) {
    const box = (await chip.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
