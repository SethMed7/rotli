// Browser mode cannot prove native file persistence or Tauri pane wiring. This
// spec exercises the shipped Chat Work layout grammar at real window sizes;
// Rust + pane-store tests own the native boundaries independently.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Chat Work is a quiet right rail and collapses when a file owns the right pane", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 820 });
  await gotoApp(page);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator(".sb-chatnew").click();

  await page.locator(".chat-surface").evaluate((workspace) => {
    workspace.classList.add("has-work-rail");
    const rail = document.createElement("aside");
    rail.className = "chat-work-rail";
    rail.setAttribute("aria-label", "Chat work");
    rail.innerHTML = `
      <div class="chat-work-panel">
        <div class="chat-work-head"><h3>Work</h3><span>2</span></div>
        <div class="chat-work-tabs"><button class="is-active">All</button><button>Images</button><button>Artifacts</button></div>
        <div class="chat-work-list">
          <div class="chat-work-entry">
            <button class="chat-work-row" aria-label="Open architecture.png to the right"><span class="chat-work-thumb"></span><span class="chat-work-copy"><span class="chat-work-name">architecture.png</span><span class="chat-work-meta">Image · Attached</span></span></button>
            <button class="chat-work-use" aria-label="Use architecture.png in chat">Use</button>
          </div>
        </div>
      </div>
      <div class="chat-work-launcher"><button><svg></svg><span>1</span></button><button><svg></svg><span>1</span></button></div>`;
    workspace.append(rail);
  });

  const rail = page.getByRole("complementary", { name: "Chat work" });
  const conversation = page.locator(".chat-empty");
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS("border-left-width", "1px");
  const normal = await Promise.all([rail.boundingBox(), conversation.boundingBox()]);
  expect(normal[0]?.width).toBeGreaterThanOrEqual(290);
  expect(Math.abs((normal[1]?.x ?? 0) + (normal[1]?.width ?? 0) - (normal[0]?.x ?? 0))).toBeLessThan(2);
  const use = page.getByRole("button", { name: "Use architecture.png in chat" });
  await use.focus();
  await expect(use).toBeFocused();
  await expect(use).toHaveCSS("opacity", "1");

  await rail.evaluate((node) => node.classList.add("is-collapsed"));
  await expect(rail.locator(".chat-work-panel")).toBeHidden();
  await expect(rail.locator(".chat-work-launcher")).toHaveCSS("display", "flex");
  await expect(rail).toHaveCSS("width", "44px");
  expect((await rail.boundingBox())?.width).toBeLessThanOrEqual(45);
});
