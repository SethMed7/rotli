// The sidebar's Home/Chat fronts (the maintainer's IA, 2026-08-01,
// docs/design/sidebar-home-chat.md). The stacked Chat/Notes accordions are
// gone: a two-segment switcher under the vault header picks which world owns
// the whole body, the System zone folds away, and both bodies scroll.
//
// Real controls only — the switcher segments, the System header, and the tab
// strip; no ⌘-chords (AGENTS.md).

import { expect, test } from "@playwright/test";

import { cycleEveryTheme, gotoApp } from "./support";

// the front chosen as Home reads "Home" (Notes by default)
const homeSeg = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Home", exact: true });
const chatSeg = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Chat", exact: true });

test("the switcher hands the whole sidebar body to one front at a time", async ({ page }) => {
  await gotoApp(page);

  // Home is the default front: the notes tree is there, the chat body is not
  await expect(homeSeg(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sb-notes-tree")).toBeVisible();
  await expect(page.locator(".sb-notes-tree .frow", { hasText: "All notes" }).first()).toBeVisible();
  await expect(page.locator(".sb-chatnew")).toHaveCount(0);

  // one click on the Chat segment swaps the body wholesale
  await chatSeg(page).click();
  await expect(chatSeg(page)).toHaveAttribute("aria-pressed", "true");
  await expect(homeSeg(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".sb-chatnew")).toBeVisible();
  await expect(page.locator(".sb-chat .sb-chatrow", { hasText: "All chats" })).toBeVisible();
  await expect(page.locator(".sb-notes-tree")).toHaveCount(0);
  // the System zone belongs to Home — it leaves with it
  await expect(page.locator(".sb-system")).toHaveCount(0);
  // …but the utility footer is app-level and stays under both fronts
  await expect(page.locator(".sb-foot")).toBeVisible();

  // and back
  await homeSeg(page).click();
  await expect(page.locator(".sb-notes-tree")).toBeVisible();
  await expect(page.locator(".sb-system")).toBeVisible();
});

test("neither front collapses — each body is one scroll of its own", async ({ page }) => {
  await gotoApp(page);

  // the old grammar folded Chat and Notes into each other; there are no
  // section headers left to fold, and the body scrolls instead
  const body = page.locator(".sb-rows");
  await expect(body).toHaveCSS("overflow-y", "auto");
  await expect(page.locator(".sb-section")).toHaveCount(0);

  await chatSeg(page).click();
  await expect(page.locator(".sb-rows")).toHaveCSS("overflow-y", "auto");
  await expect(page.locator(".sb-section")).toHaveCount(0);
});

test("the System zone folds away and comes back", async ({ page }) => {
  await gotoApp(page);

  const header = page.locator(".sb-syshdr");
  // "Assets" is unambiguous — "Library" also matches the Linked-library row
  const library = page.locator(".sb-system .frow", { hasText: "Assets" });
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(library).toBeVisible();

  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(library).toHaveCount(0);
  // the header itself stays — a folded zone must not vanish
  await expect(header).toBeVisible();

  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(library).toBeVisible();
});

test("opening content pulls the sidebar to the front that can show it", async ({ page }) => {
  await gotoApp(page);

  // start a chat from the Chat front — the pane opens and the front stays
  await chatSeg(page).click();
  await page.locator(".sb-chatnew").click();
  await expect(page.locator(".chat-surface")).toHaveCount(1);
  await expect(chatSeg(page)).toHaveAttribute("aria-pressed", "true");

  // clicking back to the seeded NOTE tab is a reveal into the notes world:
  // the sidebar must follow, or the highlighted row would be invisible
  await page.locator(".tabstrip .tab", { hasText: "rotli — notes first" }).first().click();
  await expect(homeSeg(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sb-notes-tree")).toBeVisible();

  // and returning to the chat tab pulls it back to Chat
  await page.locator(".tabstrip .tab", { hasText: "New chat" }).first().click();
  await expect(chatSeg(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sb-chatnew")).toBeVisible();
});

test("the switcher reads from semantic tokens in every environment", async ({ page }) => {
  await gotoApp(page);
  await cycleEveryTheme(page);
  const themeButton = page.getByRole("button", { name: /^Theme —/ });

  for (const theme of [
    "Warm Light",
    "Warm Dark",
    "Paper",
    "Charcoal",
    "Ocean Light",
    "Ocean Dark",
    "Grove Light",
    "Grove Dark",
    "Iris Light",
    "Iris Dark",
    "Blossom Light",
    "Blossom Dark",
    "Moonlight",
    "Midnight",
  ] as const) {
    await expect(themeButton).toHaveAccessibleName(new RegExp(`^Theme — ${theme} · `));

    const active = homeSeg(page);
    await expect(active).toHaveCSS("box-shadow", "none");
    const colors = await active.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.cssText = [
        "position:fixed",
        "visibility:hidden",
        "background:var(--selected-bg)",
        "color:var(--selected-ink)",
      ].join(";");
      document.body.append(probe);
      const actual = getComputedStyle(node);
      const semantic = getComputedStyle(probe);
      const trough = getComputedStyle(node.parentElement as HTMLElement);
      const troughProbe = document.createElement("span");
      troughProbe.style.cssText = "position:fixed;visibility:hidden;background:var(--tint)";
      document.body.append(troughProbe);
      const result = {
        background: [actual.backgroundColor, semantic.backgroundColor],
        text: [actual.color, semantic.color],
        border: actual.borderTopColor,
        trough: [trough.backgroundColor, getComputedStyle(troughProbe).backgroundColor],
      };
      probe.remove();
      troughProbe.remove();
      return result;
    });

    // Active state stays a quiet semantic wash in every family: recognizable,
    // but never the old solid-accent block that competed with the user's work.
    expect(colors.background[0]).toBe(colors.background[1]);
    expect(colors.text[0]).toBe(colors.text[1]);
    // border folds into the fill — no ring competing with the pill
    expect(colors.border).toBe("rgba(0, 0, 0, 0)");
    expect(colors.trough[0]).toBe(colors.trough[1]);
    expect(colors.background[0]).not.toBe(colors.trough[0]);

    await themeButton.click();
  }
});

test("the Activity overview fills the available pane on a wide display", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await gotoApp(page);

  await page.getByRole("button", { name: "Open Rotli activity dashboard" }).click();

  const pane = page.locator(".dashboard-surface");
  const header = page.locator(".dashboard-head");
  await expect(pane).toBeVisible();

  const paneBox = await pane.boundingBox();
  const headerBox = await header.boundingBox();
  expect(paneBox?.width).toBeGreaterThan(1500);
  expect(headerBox?.width).toBeGreaterThan(1300);
});

// The owner, 2026-09-30: "turn off Chat and Breve, then Notes too; the user
// chooses their home (Notes by default); at least one on; with one on, hide
// the switcher."
test("fronts turn off in Settings → Sidebar; one left hides the switcher and can't go off", async ({
  page,
}) => {
  await gotoApp(page);
  const switcher = page.getByRole("group", { name: "Sidebar front" });
  const openSidebarSettings = async () => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
  };
  const backToNotes = () => page.getByRole("button", { name: /Back to notes/ }).click();
  const section = page.locator(".swgroup").filter({ has: page.getByRole("switch", { name: /^Notes/ }) });
  const toggle = (name: string) => section.getByRole("switch", { name: new RegExp(`^${name}`) });
  const opensOn = page.locator(".segfield", { has: page.locator(".seglabel", { hasText: "Home" }) });

  await openSidebarSettings();
  await expect(toggle("Notes")).toHaveAttribute("aria-checked", "true");
  // where Rotli opens: Notes by default
  await expect(opensOn.getByRole("button", { name: "Notes", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // Chat off: its segment leaves the switcher
  await toggle("Chat").click();
  await expect(toggle("Chat")).toHaveAttribute("aria-checked", "false");
  await backToNotes();
  await expect(switcher.getByRole("button", { name: "Chat", exact: true })).toHaveCount(0);

  // Breve off too (where this build has it): one front left, no switcher,
  // and its switch is locked on
  await openSidebarSettings();
  const breve = toggle("Breve");
  if (await breve.count()) await breve.click();
  await expect(toggle("Notes")).toBeDisabled();
  await expect(opensOn).toHaveCount(0);
  await backToNotes();
  await expect(switcher).toHaveCount(0);
  await expect(page.locator(".sb-notes-tree")).toBeVisible();

  // Chat back on, and chosen as where Rotli opens
  await openSidebarSettings();
  await toggle("Chat").click();
  await opensOn.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(opensOn.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await backToNotes();
  // the owner, 2026-10-01: whichever is home is called Home, and can't be
  // dragged out — Chat as home reads Home, with no pull-out; Notes is Notes
  await expect(switcher.getByRole("button")).toHaveText(["Home", "Notes"]);
  await expect(switcher.getByRole("button", { name: "Home", exact: true })).toHaveAttribute(
    "data-tour",
    "chat",
  );
  await expect(page.getByRole("button", { name: "Pull Chat out into its own window" })).toHaveCount(0);
});
