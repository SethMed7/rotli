// The composer's model picker is a compact menu with a visible edge: 340px
// wide, a 44px provider rail, single-line rows, and the floating-surface border
// token. The browser twin has no models, so the picker never mounts on its own —
// this renders its markup into a chat pane and measures the real stylesheet.
// Where it opens (beside the chip, clamped to the window) is unit-tested in
// src/lib/popover.test.ts.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("the model picker is compact, single-line, and edged like other floating surfaces", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator(".sb-chatnew").click();

  const fit = await page.locator(".chat-surface").evaluate((surface) => {
    const pop = document.createElement("div");
    pop.className = "chat-modelpop";
    pop.style.left = "8px";
    pop.style.top = "8px";
    pop.innerHTML = `
      <nav class="chat-modelpop-rail">
        <button type="button" class="chat-model-provider sel"><span>L</span><span class="chat-model-provider-count">3</span></button>
        <button type="button" class="chat-model-provider"><span>C</span><span class="chat-model-provider-count">2</span></button>
      </nav>
      <div class="chat-modelpop-main">
        <label class="chat-model-search"><input placeholder="Search models…" /></label>
        <div class="chat-modelpop-heading"><div><strong>On this Mac</strong></div><span>3</span></div>
        <div class="chat-modelpop-list">
          <button type="button" class="chat-modelrow sel"><span class="chat-modelrow-logo">G</span><span class="chat-modelrow-copy"><span class="chat-modelrow-name">gemma-3-12b</span></span></button>
          <button type="button" class="chat-modelrow"><span class="chat-modelrow-logo">Q</span><span class="chat-modelrow-copy"><span class="chat-modelrow-name">a rather long local model name that must ellipsize</span></span></button>
        </div>
      </div>`;
    surface.appendChild(pop);
    const rows = [...pop.querySelectorAll(".chat-modelrow")].map((r) => r.getBoundingClientRect().height);
    // a long catalogue under the 360px cap scrolls inside the list
    const list = pop.querySelector(".chat-modelpop-list")!;
    for (let i = 0; i < 30; i++) list.appendChild(list.lastElementChild!.cloneNode(true));
    pop.style.maxHeight = "360px";
    const capped = pop.getBoundingClientRect().height;
    const listScrolls = list.scrollHeight > list.clientHeight;
    const probe = document.createElement("div");
    probe.style.borderColor = "var(--border-strong)";
    document.body.appendChild(probe);
    const strong = getComputedStyle(probe).borderColor;
    probe.remove();
    return {
      width: pop.getBoundingClientRect().width,
      rail: pop.querySelector(".chat-modelpop-rail")!.getBoundingClientRect().width,
      provider: pop.querySelector(".chat-model-provider")!.getBoundingClientRect().width,
      rows,
      capped,
      listScrolls,
      border: getComputedStyle(pop).borderTopColor,
      strong,
    };
  });

  expect(fit.width).toBeLessThanOrEqual(340);
  expect(fit.rail).toBe(44);
  expect(fit.provider).toBe(30);
  // a long name ellipsizes on one line instead of wrapping the row taller
  for (const height of fit.rows) expect(height).toBeLessThanOrEqual(33);
  expect(fit.capped).toBeLessThanOrEqual(360);
  expect(fit.listScrolls).toBe(true);
  expect(fit.border).toBe(fit.strong);
});
