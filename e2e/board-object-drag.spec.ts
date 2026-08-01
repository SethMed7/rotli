// Regression-layer handoff item 3 (docs/architecture/code-audit.md): board
// object drag. BoardSurface's Captures grid reorders cards by pointer-drag
// (src/components/boardSurface.tsx's startCardDrag) into a manually persisted
// `captureOrder` — distinct from the tab/Main gestures the other specs cover.

import { expect, test } from "@playwright/test";

import { edgePoint, gotoApp, pointerDrag } from "./support";

test("dragging a capture card onto another card's left half reorders before it", async ({ page }) => {
  await gotoApp(page);

  await page.locator(".sb-notes-tree .frow", { hasText: "Captures" }).first().click();
  const titles = page.locator(".board-card .bc-title");
  await expect(titles).toHaveCount(3);

  // seeded newest-first: Gateway (8m ago), Idea (25m ago), Ask Maria (40m ago)
  await expect(titles).toHaveText([/Gateway export enum/, /Idea: warm empty-state/, /Ask Maria/]);

  const askMaria = page.locator(".board-card", { hasText: "Ask Maria about the settlement" });
  const gateway = page.locator(".board-card", { hasText: "Gateway export enum" });
  const dropPoint = await edgePoint(gateway, "left");
  await pointerDrag(page, askMaria, dropPoint);

  await expect(titles).toHaveText([/Ask Maria/, /Gateway export enum/, /Idea: warm empty-state/]);
});

test("capture cards select on click and open on double-click", async ({ page }) => {
  await gotoApp(page);
  await page.locator(".sb-notes-tree .frow", { hasText: "Captures" }).first().click();
  const card = page.locator("[data-cap-id]").first();
  await card.click();
  await expect(page.locator(".board-bar-count")).toContainText("1 selected");
  await card.dblclick();
  await expect(page.locator(".cm-content").last()).toBeVisible();
});
