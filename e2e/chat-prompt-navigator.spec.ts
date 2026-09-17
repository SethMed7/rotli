// The prompt navigator is a stack of cards beside the left-edge marker, not a
// centered dialog and not one long list: the card you're on is fully visible
// and its neighbours fade a step at a time (the owner, 2026-09-17). The stack
// should read as an extension of the marker: adjacent and top-aligned
// whenever the pane has room.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the prompt menu opens beside and top-aligned with its marker", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator(".sb-chatnew").click();

  await page.locator(".chat-surface").evaluate((surface) => {
    surface.innerHTML = `
      <main class="chat-main">
        <div class="chat-conversation">
          <nav class="chat-prompt-nav" aria-label="Conversation prompts">
            <div class="chat-prompt-trigger lines open">
              <button class="chat-prompt-marker" type="button"><span></span></button>
              <button class="chat-prompt-marker preview" type="button"><span></span></button>
              <button class="chat-prompt-marker" type="button"><span></span></button>
              <button class="chat-prompt-marker" type="button"><span></span></button>
              <button class="chat-prompt-marker active" type="button" aria-current="location"><span></span></button>
            </div>
            <div class="chat-prompt-menu" aria-label="Jump to prompt">
              <div class="chat-prompt-list">
                <button type="button" class="chat-prompt-card" style="--d: 3">Find the architectural boundary</button>
                <button type="button" class="chat-prompt-card" style="--d: 2">Compare the two approaches</button>
                <button type="button" class="chat-prompt-card" style="--d: 1">Test the failure state</button>
                <button type="button" class="chat-prompt-card focal preview" style="--d: 0">Summarize the result</button>
                <button type="button" class="chat-prompt-card active" style="--d: 1" aria-current="location">Choose the next step</button>
              </div>
            </div>
          </nav>
        </div>
      </main>`;
  });

  const geometry = await page.evaluate(() => {
    const trigger = document.querySelector(".chat-prompt-trigger")?.getBoundingClientRect();
    const menu = document.querySelector(".chat-prompt-menu")?.getBoundingClientRect();
    if (!trigger || !menu) throw new Error("prompt navigator scaffold missing");
    return {
      topDifference: Math.round(menu.top - trigger.top),
      horizontalGap: Math.round(menu.left - trigger.right),
    };
  });

  expect(geometry).toEqual({ topDifference: 0, horizontalGap: 8 });
  await expect(page.locator(".chat-prompt-menu")).not.toContainText("Jump to prompt");

  const marker = page.locator(".chat-prompt-marker").nth(2);
  await marker.hover();
  expect(await marker.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  const stack = await page.locator(".chat-prompt-menu").evaluate((menu) => {
    const cards = Array.from(menu.querySelectorAll<HTMLElement>(".chat-prompt-card"));
    const focal = menu.querySelector<HTMLElement>(".focal");
    const active = menu.querySelector<HTMLElement>(".active");
    if (!focal || !active) throw new Error("prompt card scaffold missing");
    const style = (el: Element) => getComputedStyle(el);
    return {
      // the container has no chrome of its own — the cards are the surface
      menuBorder: style(menu).borderStyle,
      menuBackground: style(menu).backgroundColor,
      cardBorder: style(cards[0]!).borderStyle,
      // a tint, never transparency: every card is opaque, the words behind never show
      opacities: cards.map((c) => Number(style(c).opacity)),
      colors: cards.map((c) => style(c).color),
      backgrounds: cards.map((c) => style(c).backgroundColor),
      focalColor: style(focal).color,
      activeBackground: style(active).backgroundColor,
      cardBackground: style(cards[0]!).backgroundColor,
      previewDecoration: style(focal).textDecorationLine,
    };
  });
  expect(stack.menuBorder).toBe("none");
  expect(stack.menuBackground).toBe("rgba(0, 0, 0, 0)");
  expect(stack.cardBorder).toBe("solid");
  expect(stack.opacities).toEqual([1, 1, 1, 1, 1]);
  // three steps up: each further card a different, fainter tint than the nearer one
  expect(new Set(stack.colors.slice(0, 4)).size).toBe(4);
  expect(new Set(stack.backgrounds.slice(0, 4)).size).toBe(4);
  expect(stack.colors[3]).toBe(stack.focalColor);
  // the prompt on screen keeps its selected tint even one step away
  expect(stack.activeBackground).not.toBe(stack.cardBackground);
  expect(stack.previewDecoration).toBe("none");
  await page.screenshot({
    path: "test-results/prompt-cards.png",
    clip: { x: 0, y: 0, width: 900, height: 700 },
  });
});
