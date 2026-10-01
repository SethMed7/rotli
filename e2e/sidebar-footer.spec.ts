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

// Audit 2026-09-28: a Librarian count and the Settings update dot used to sit
// beside their labels and cut "Librarian" to "Libra…" at every width. They
// sit on the icons now; with badges, at the narrowest width that shows labels,
// every label is still whole.
test("badges sit on the icons and never cut a label short", async ({ page }) => {
  await gotoApp(page);
  // labels appear once the footer's content box reaches 380px (about a 410px sidebar)
  await setSidebarWidth(page, 420);
  await expect(labels(page)).toHaveText(["Files", "Librarian", "Settings", "Feedback"]);
  for (const label of await labels(page).all()) await expect(label).toBeVisible();
  // the twin has no Librarian queue or update feed: place the badges the
  // component renders, where it renders them
  await page.evaluate(() => {
    const icons = document.querySelectorAll(".sb-foot .sb-footicon");
    const pill = document.createElement("span");
    pill.className = "count pill";
    pill.textContent = "99+";
    icons[0]?.append(pill);
    const dot = document.createElement("span");
    dot.className = "sb-update-dot";
    icons[1]?.append(dot);
  });
  for (const label of await labels(page).all()) {
    const [scroll, client] = await label.evaluate((node) => [node.scrollWidth, node.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
  }
  const pill = footer(page).locator(".count.pill");
  const button = footer(page).getByRole("button", { name: "Librarian", exact: true });
  const name = button.locator(".fname");
  const [p, b, n] = [await pill.boundingBox(), await button.boundingBox(), await name.boundingBox()];
  expect(p!.x).toBeGreaterThanOrEqual(b!.x); // inside its button
  expect(p!.x + p!.width).toBeLessThanOrEqual(n!.x); // and clear of the label
});

// The owner, 2026-10-01: "side bar footer if just settings hide it since we
// have settings top right". With Files, Librarian, and Feedback hidden, the
// footer goes; the tour's Settings step points at the titlebar's Settings.
test("a footer left with only Settings goes away; the tour finds Settings in the titlebar", async ({
  page,
}) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  for (const name of [/^Files/, /^Librarian/, /^Feedback/]) {
    const toggle = page.getByRole("switch", { name });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(footer(page)).toHaveCount(0);

  await page
    .locator(".titlebar")
    .getByRole("button", { name: /^Settings/ })
    .click();
  await page.getByRole("button", { name: "Show me around" }).click();
  const tour = page.getByRole("region", { name: "Guided tour" });
  for (let index = 0; index < 6; index++) {
    if ((await tour.getAttribute("data-step")) === "settings") break;
    await tour.getByRole("button", { name: "Next" }).click();
  }
  await expect(tour).toHaveAttribute("data-step", "settings");
  await expect(page.locator(".titlebar [data-tour-active]")).toHaveCount(1);
});
