// The prompt navigator is a compact landmark list, not a centered dialog. Its
// menu should read as an extension of the left-edge marker: adjacent and
// top-aligned whenever the pane has room.

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
                <button type="button">Find the architectural boundary</button>
                <button type="button" class="preview">Compare the two approaches</button>
                <button type="button">Test the failure state</button>
                <button type="button">Summarize the result</button>
                <button type="button" class="active" aria-current="location">Choose the next step</button>
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

  const rowStates = await page.locator(".chat-prompt-list").evaluate((list) => {
    const preview = list.querySelector<HTMLElement>(".preview");
    const active = list.querySelector<HTMLElement>(".active");
    if (!preview || !active) throw new Error("prompt row state scaffold missing");
    return {
      previewBackground: getComputedStyle(preview).backgroundColor,
      previewDecoration: getComputedStyle(preview).textDecorationLine,
      previewOpacity: Number(getComputedStyle(preview).opacity),
      activeBackground: getComputedStyle(active).backgroundColor,
      activeIndicator: getComputedStyle(active, "::before").content,
      activeOpacity: Number(getComputedStyle(active).opacity),
    };
  });
  expect(rowStates.previewDecoration).toBe("none");
  expect(rowStates.previewOpacity).toBeLessThan(rowStates.activeOpacity);
  expect(rowStates.previewBackground).not.toBe(rowStates.activeBackground);
  expect(rowStates.activeIndicator).toBe("none");
});
