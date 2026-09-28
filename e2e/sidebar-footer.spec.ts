// The sidebar's utility footer (2026-09-28, the owner's screenshots): Files ·
// Librarian · Settings · Feedback. A narrow sidebar shows the icons alone
// instead of "Fi… Li… S…"; each button keeps its name; Feedback opens the same
// prefilled GitHub issue as Settings → About.

import { expect, test, type Page } from "@playwright/test";

import { gotoApp } from "./support";

async function setSidebarWidth(page: Page, px: number): Promise<void> {
  await page.evaluate(async (width) => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((entry) => new URL(entry).pathname === "/src/state/ui.ts");
    if (!url) throw new Error("ui store is not mounted");
    const { useUiStore } = await import(/* @vite-ignore */ url);
    useUiStore.getState().setSidebarWidth(width);
  }, px);
}

const footer = (page: Page) => page.locator(".sb-foot");
const labels = (page: Page) => footer(page).locator(".fname");

test("a narrow sidebar's footer shows named icons; a wide one shows the labels", async ({ page }) => {
  await gotoApp(page);
  for (const name of ["Files", "Librarian", "Settings", "Feedback"]) {
    await expect(footer(page).getByRole("button", { name, exact: true })).toBeVisible();
  }
  await setSidebarWidth(page, 240);
  await expect(labels(page).first()).toBeHidden();
  await setSidebarWidth(page, 440);
  await expect(labels(page)).toHaveText(["Files", "Librarian", "Settings", "Feedback"]);
  for (const label of await labels(page).all()) {
    // a shown label is whole, never cut to "Fi…"
    const [scroll, client] = await label.evaluate((node) => [node.scrollWidth, node.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
  }
});

test("Feedback opens a prefilled GitHub issue", async ({ page, context }) => {
  // never reach the real site from a test: answer github.com locally
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>issue</title>" }),
  );
  await gotoApp(page);
  const popup = page.waitForEvent("popup");
  await footer(page).getByRole("button", { name: "Feedback", exact: true }).click();
  const issue = await popup;
  expect(issue.url()).toContain("github.com/SethMed7/rotli/issues/new");
  expect(decodeURIComponent(issue.url())).toContain("Rotli");
});
