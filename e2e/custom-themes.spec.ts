// Custom themes in Settings → Appearance → My themes: import a theme file
// through the real Import control, and check the colours the page actually
// resolves. Each role is read back from the browser (a probe painted with the
// role, flattened through a 1×1 canvas so oklch() and color-mix() come back as
// 8-bit sRGB) and measured with the engine's own contrast function. Translucent
// layers are composited over their surface first, as the gate does.

import { expect, test, type Page } from "@playwright/test";

import { contrast } from "../src/brand/themeEngine/color";
import { resolveSeeds } from "../src/brand/themeEngine/resolve";
import { FOREST_PAPER, themeText } from "../src/brand/themeEngine/themes.fixtures";
import { gotoApp } from "./support";

async function appearance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
}

async function importTheme(page: Page, theme: object, name = "forest-paper.rotli-theme.json"): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import theme…", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(themeText(theme)) });
}

/** Each role as the page resolves it: `#rrggbb`, or `{ over, alpha }` for a
 * translucent one, composited here over `on`. */
async function painted(page: Page, roles: Record<string, string>): Promise<Record<string, string>> {
  return page.evaluate((input) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const probe = document.createElement("span");
    document.body.append(probe);
    const resolved = (value: string): string => {
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    // paint the layers bottom-up on the 1×1 canvas and read the pixel back
    const flatten = (layers: string[]): string => {
      ctx.clearRect(0, 0, 1, 1);
      for (const layer of layers) {
        ctx.fillStyle = resolved(layer);
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    };
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(input)) {
      const [top, on] = value.split(" over ");
      out[name] = flatten(on ? [on, top!] : [top!]);
    }
    probe.remove();
    return out;
  }, roles);
}

const ROLES = {
  ground: "var(--ground)",
  surface: "var(--surface)",
  panel: "var(--surface-2)",
  tint: "var(--tint)",
  text: "var(--text)",
  muted: "var(--text-muted)",
  link: "var(--accent-text)",
  accent: "var(--accent)",
  onAccent: "var(--on-accent)",
  syntax: "var(--syntax-blue)",
  row: "var(--selected-bg) over var(--surface-2)",
  selection: "color-mix(in srgb, var(--accent) 30%, transparent) over var(--ground)",
};

/** The key pairs, each at its floor (Standard). */
function expectReadable(c: Record<string, string>): void {
  const pairs: [string, string, string, number][] = [
    ["text on the page", c.text!, c.ground!, 9],
    ["text on a card", c.text!, c.surface!, 4.5],
    ["secondary text on a panel", c.muted!, c.panel!, 4.5],
    ["secondary text on tint", c.muted!, c.tint!, 4.5],
    ["a link on tint", c.link!, c.tint!, 4.5],
    ["a button label", c.onAccent!, c.accent!, 4.5],
    ["the accent on the page", c.accent!, c.ground!, 3],
    ["code syntax on a card", c.syntax!, c.surface!, 4.5],
    ["text on the current row", c.text!, c.row!, 4.5],
    ["text in a selection", c.text!, c.selection!, 4.5],
  ];
  const measured = pairs.map(([what, fg, bg, floor]) => ({ what, ratio: contrast(fg, bg), floor }));
  expect(measured.filter((m) => m.ratio < m.floor)).toEqual([]);
}

const forest = resolveSeeds(FOREST_PAPER.seeds)!;

test("an imported theme applies over the whole page, readable by day and at night", async ({ page }) => {
  await gotoApp(page);
  await appearance(page);
  await importTheme(page, FOREST_PAPER);

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "custom-light");
  await expect(html).toHaveAttribute("data-theme-id", "forest-paper");
  const card = page.locator('[data-theme-card="forest-paper"] .famcard');
  await expect(card).toHaveAttribute("aria-pressed", "true");
  // its base became the family, and that card isn't also selected
  await expect(page.getByRole("button", { name: /^Grove/ })).toHaveAttribute("aria-pressed", "false");

  const day = await painted(page, ROLES);
  // the theme's own page, not the Paper fallback underneath it
  expect(day.ground).toBe(forest.light.tokens["--ground"]);
  expect(day.text).toBe(forest.light.tokens["--text"]);
  expectReadable(day);

  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "custom-dark");
  const night = await painted(page, ROLES);
  expect(night.ground).toBe(forest.dark.tokens["--ground"]);
  expectReadable(night);

  // the body itself, as painted
  const body = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return [style.color, style.backgroundColor];
  });
  const flat = await painted(page, { color: body[0]!, background: body[1]! });
  expect(contrast(flat.color!, flat.background!)).toBeGreaterThanOrEqual(9);
});

test("a Primary color and the Monochrome syntax palette still work under a custom theme", async ({
  page,
}) => {
  await gotoApp(page);
  await appearance(page);
  await importTheme(page, FOREST_PAPER);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "custom-light");

  await page.getByRole("radio", { name: "Blue" }).click();
  await expect(html).toHaveAttribute("data-accent", "blue");
  const blue = await painted(page, ROLES);
  // the preset re-solved on this page, not the static preset or the theme's green
  expect(blue.accent).not.toBe(forest.light.tokens["--accent"]);
  expect(blue.ground).toBe(forest.light.tokens["--ground"]);
  expectReadable(blue);

  await page.getByRole("radio", { name: "Custom color" }).click();
  await page.getByRole("slider", { name: "Custom primary color hue" }).fill("300");
  await expect
    .poll(async () => (await painted(page, { accent: "var(--accent)" })).accent)
    .not.toBe(blue.accent);
  expectReadable(await painted(page, ROLES));

  await page.getByRole("button", { name: "Monochrome", exact: true }).click();
  await expect(html).toHaveAttribute("data-syntax-palette", "mono");
  const mono = await painted(page, { syntax: "var(--syntax-blue)", text: "var(--text)" });
  expect(mono.syntax).toBe(mono.text);
});

test("the titlebar sun flips the theme's day and night, and a family card leaves it", async ({ page }) => {
  await gotoApp(page);
  await appearance(page);
  await importTheme(page, FOREST_PAPER);
  const sun = page.getByRole("button", { name: /^Theme — / });
  await expect(sun).toHaveAccessibleName("Theme — Forest Paper by day · click for Forest Paper at night");
  await sun.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "custom-dark");

  await page.getByRole("button", { name: /^Ocean/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean-dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-id", /.*/);
});

test("rename, export, and a two-step delete that lands on the base family", async ({ page }) => {
  await gotoApp(page);
  await appearance(page);
  await importTheme(page, FOREST_PAPER);
  const card = page.locator('[data-theme-card="forest-paper"]');

  await card.getByRole("button", { name: "Rename", exact: true }).click();
  const field = card.getByRole("textbox", { name: "New name for Forest Paper" });
  await field.fill("Forest at Dusk");
  await field.press("Enter");
  await expect(card.locator(".famlabel")).toHaveText("Forest at Dusk");

  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Forest at Dusk.rotli-theme.json");

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await card
    .getByRole("group", { name: "Delete Forest at Dusk?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(card).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "grove-light");
});

test("a file that isn't a theme is refused with a reason, and nothing changes", async ({ page }) => {
  await gotoApp(page);
  await appearance(page);
  await importTheme(
    page,
    { rotliTheme: 1, seeds: { light: { page: "url(https://example.com)" } } },
    "bad.json",
  );
  await expect(page.getByRole("alert")).toHaveText(
    "The day half needs a page color and an accent, as #rrggbb.",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
