// The sidebar's Home/Chat fronts (Seth's IA, 2026-08-01,
// docs/design/sidebar-home-chat.md). The stacked Chat/Notes accordions are
// gone: a two-segment switcher under the vault header picks which world owns
// the whole body, the System zone folds away, and both bodies scroll.
//
// Real controls only — the switcher segments, the System header, and the tab
// strip; no ⌘-chords (AGENTS.md).

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

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

test("the switcher reads from semantic tokens in all four environments", async ({ page }) => {
  await gotoApp(page);
  const themeButton = page.getByRole("button", { name: /^Theme —/ });

  for (const theme of ["Warm Light", "Warm Dark", "Paper", "Charcoal"] as const) {
    await expect(themeButton).toHaveAccessibleName(`Theme — ${theme}`);

    const active = homeSeg(page);
    await expect(active).toHaveCSS("box-shadow", "none");
    const colors = await active.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.cssText = [
        "position:fixed",
        "visibility:hidden",
        "background:var(--accent)",
        "color:var(--on-accent)",
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

    // the active segment IS the ONE active-item state: the solid accent pill the
    // open note + open chat wear, sitting in the recessed --tint trough — same
    // active language everywhere, hierarchy by contrast never a shadow.
    expect(colors.background[0]).toBe(colors.background[1]);
    expect(colors.text[0]).toBe(colors.text[1]);
    // border folds into the fill — no ring competing with the pill
    expect(colors.border).toBe("rgba(0, 0, 0, 0)");
    expect(colors.trough[0]).toBe(colors.trough[1]);
    expect(colors.background[0]).not.toBe(colors.trough[0]);

    await themeButton.click();
  }
});
