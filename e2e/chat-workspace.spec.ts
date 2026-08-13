// Browser mode cannot prove native file persistence or Tauri pane wiring. This
// spec exercises the shipped Chat Work layout grammar at real window sizes;
// Rust + pane-store tests own the native boundaries independently.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("Chat artifacts occupy a stable right rail and release it when closed", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 820 });
  await gotoApp(page);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.locator(".sb-chatnew").click();

  await page.locator(".chat-surface").evaluate((workspace) => {
    workspace.classList.add("artifacts-visible");
    const rail = document.createElement("aside");
    rail.className = "chat-artifacts-panel";
    rail.setAttribute("aria-label", "Chat artifacts");
    rail.innerHTML = `
      <div class="chat-artifacts-head"><div><strong>Artifacts</strong><span>1</span></div><button aria-label="Close artifacts">×</button></div>
      <div class="chat-artifacts-list">
        <button class="chat-artifact" aria-label="Open architecture.png"><span class="chat-artifact-preview"></span><span class="chat-artifact-copy"><strong>architecture.png</strong><small>PNG</small></span></button>
      </div>
    `;
    workspace.append(rail);
  });

  const rail = page.getByRole("complementary", { name: "Chat artifacts" });
  const conversation = page.locator(".chat-empty");
  await expect(rail).toBeVisible();
  await expect(rail).toHaveCSS("border-left-width", "1px");
  const normal = await Promise.all([rail.boundingBox(), conversation.boundingBox()]);
  expect(normal[0]?.width).toBeGreaterThanOrEqual(290);
  expect(Math.abs((normal[1]?.x ?? 0) + (normal[1]?.width ?? 0) - (normal[0]?.x ?? 0))).toBeLessThan(2);

  await page.locator(".chat-surface").evaluate((workspace) => {
    workspace.classList.remove("artifacts-visible");
    workspace.querySelector(".chat-artifacts-panel")?.remove();
  });
  await expect(rail).toBeHidden();
  const restored = await conversation.boundingBox();
  expect(restored?.width).toBeGreaterThan(normal[1]?.width ?? 0);
});
