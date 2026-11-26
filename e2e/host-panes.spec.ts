// The host pane seams in a real browser (docs/architecture/host-seams.md):
// where keyboard focus goes after a link or a hidden pane, and the effects a
// server render never runs. The host is synthetic (host-panes.fixture.ts).

import { expect, type Page, test } from "@playwright/test";

import type { SyntheticHost } from "./host-panes.fixture";
import { gotoApp } from "./support";

type Driven = Window & { syntheticHost: SyntheticHost };

const setReady = (page: Page, ready: boolean) =>
  page.evaluate((value) => (window as unknown as Driven).syntheticHost.setReady(value), ready);
const listening = (page: Page) =>
  page.evaluate(() => (window as unknown as Driven).syntheticHost.listening());

// The app's own store, by the URL it was served from. Called from the page, not
// the fixture: Vite rewrites a module's dynamic import to a second instance.
const UI_STORE = "/src/state/ui.ts";
const askFor = (page: Page, pane: string) =>
  page.evaluate(
    async ([url, id]) => (await import(url!)).useUiStore.getState().setSettingsPaneRequest(id),
    [UI_STORE, pane],
  );
const askedFor = (page: Page) =>
  page.evaluate(async (url) => (await import(url)).useUiStore.getState().settingsPaneRequest, UI_STORE);

async function openSettings(page: Page) {
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      '<script type="module" src="/src/main.tsx">',
      '<script type="module" src="/e2e/host-panes.fixture.ts"></script>$&',
    );
    await route.fulfill({ response, body });
  });
  await gotoApp(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  return {
    row: (name: string) => nav.getByRole("button", { name, exact: true }),
    button: (name: string) => page.getByRole("button", { name, exact: true }),
    heading: page.locator(".set-banner-title"),
  };
}

test("a pane link takes keyboard focus to the new pane's nav row", async ({ page }) => {
  const { row, button, heading } = await openSettings(page);
  await row("Links").click();
  await button("Open connections").press("Enter");
  await expect(heading).toHaveText("Connections");
  await expect(row("Connections")).toBeFocused();
  // from one host pane to another, the same
  await row("Links").click();
  await button("Open gated").press("Enter");
  await expect(heading).toHaveText("Gated");
  await expect(row("Gated")).toBeFocused();
  // a link to the pane already open takes nothing away, so focus stays on it
  await row("Links").click();
  await button("Open links").press("Enter");
  await expect(button("Open links")).toBeFocused();
});

test("an open pane that hides hands focus to General's row, and only focus it took", async ({ page }) => {
  const { row, button, heading } = await openSettings(page);
  await row("Gated").click();
  await button("Inside the gated pane").focus();
  await setReady(page, false);
  await expect(row("Gated")).toHaveCount(0);
  await expect(heading).toHaveText("General");
  await expect(row("General")).toBeFocused();
  // the pane coming back doesn't pull the person back to it
  await setReady(page, true);
  await expect(row("Gated")).toHaveCount(1);
  await expect(heading).toHaveText("General");
  // focus somewhere that survives stays where it is
  await row("Gated").click();
  await button("Back to notes").focus();
  await setReady(page, false);
  await expect(heading).toHaveText("General");
  await expect(button("Back to notes")).toBeFocused();
});

test("Settings drops a request for a hidden pane, and stops listening when it closes", async ({ page }) => {
  const { row, button, heading } = await openSettings(page);
  await expect.poll(() => listening(page)).toBe(1);
  await setReady(page, false);
  await expect(row("Gated")).toHaveCount(0);
  await row("Appearance").click();
  // asked the way Rotli's own surfaces ask: consumed, and nothing moved
  await askFor(page, "gated");
  await expect.poll(() => askedFor(page)).toBeNull();
  await expect(heading).toHaveText("Appearance");
  // under the dev server a link to no pane at all is a mistake worth seeing
  await row("Links").click();
  await button("Open nowhere").click();
  await expect(page.locator("output")).toContainText('unknown Settings pane "nowhere"');
  await button("Back to notes").click();
  await expect.poll(() => listening(page)).toBe(0);
});
