// Tab hover is paint-only: revealing the close control must never resize the
// hovered tab or push its neighbours. This is browser-twin coverage for the
// DOM/CSS contract; native titlebar rendering remains a packaged-app check.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

test("hovering an inactive tab does not move the tab strip", async ({ page }) => {
  await gotoApp(page);

  // Use real tab-strip controls to create enough neighbours for a reflow to be
  // observable. The last new tab is active; the seeded first tab is inactive.
  const addTab = page.locator(".tabplus");
  await addTab.click();
  await addTab.click();

  const tabs = page.locator(".tabstrip .tab");
  await expect(tabs).toHaveCount(3);
  const hovered = tabs.nth(0);
  const neighbour = tabs.nth(1);
  const before = await hovered.boundingBox();
  const neighbourBefore = await neighbour.boundingBox();
  expect(before).not.toBeNull();
  expect(neighbourBefore).not.toBeNull();

  await hovered.hover();

  const after = await hovered.boundingBox();
  const neighbourAfter = await neighbour.boundingBox();
  expect(after).toEqual(before);
  expect(neighbourAfter).toEqual(neighbourBefore);
  await expect(hovered.locator(".x")).toBeVisible();

  // Selecting that same tab changes hierarchy, not geometry.
  await hovered.click();
  expect(await hovered.boundingBox()).toEqual(before);
  expect(await neighbour.boundingBox()).toEqual(neighbourBefore);
  await expect(hovered).toHaveAttribute("aria-selected", "true");
});

test("compact shell actions keep useful pointer targets in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await gotoApp(page);

  const sidebarToggle = page.getByRole("button", { name: "Hide sidebar" });
  await sidebarToggle.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(sidebarToggle).toBeFocused();
  await expect(sidebarToggle.locator(".tip")).toBeVisible();

  const actions = [
    page.getByRole("button", { name: "New note in Main" }),
    page.getByRole("button", { name: "New folder in Main" }),
    page.getByRole("button", { name: "Close tab" }),
  ];
  for (const action of actions) {
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
  }

  for (const name of ["Chats on this note", "Aa", "Show metadata"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height).toBeGreaterThanOrEqual(28);
  }
});

test("General settings switch the crowded tab bar between scroll and fit", async ({ page }) => {
  await gotoApp(page);

  const strip = page.getByRole("tablist");
  await expect(strip).toHaveAttribute("data-tab-layout", "scroll");

  const addTab = page.locator(".tabplus");
  for (let i = 0; i < 12; i += 1) await addTab.click();
  const scroller = page.locator(".tabscroll");
  expect(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Fit to window", exact: true }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(strip).toHaveAttribute("data-tab-layout", "fit");
  expect(await scroller.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
});
