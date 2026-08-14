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
            <button class="chat-prompt-trigger open" type="button" aria-label="Jump to an earlier prompt">
              <span></span><span></span><span></span><span></span><span class="active"></span>
            </button>
            <div class="chat-prompt-menu" aria-label="Jump to prompt">
              <div class="chat-prompt-list">
                <button type="button">Find the architectural boundary</button>
                <button type="button">Compare the two approaches</button>
                <button type="button">Test the failure state</button>
                <button type="button">Summarize the result</button>
                <button type="button" class="active">Choose the next step</button>
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
});
