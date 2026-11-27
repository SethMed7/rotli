// What the native shell asks of the main page, in a real browser
// (docs/architecture/host-seams.md, "Opening Settings" and "Held for the
// page"). The browser has no Rust, so the spec calls the functions the page's
// listeners call: `openSettingsFromHost` for a `rotli:open-settings` event,
// and `attachPageRequests` with the page's own handlers over a transport that
// holds a notice, for a cold launch. The host is synthetic
// (host-panes.fixture.ts); ROTLI_WALK_DIR saves a screenshot per step.

import { expect, type Page, test } from "@playwright/test";

import type { SyntheticHost } from "./host-panes.fixture";
import { gotoApp } from "./support";

type Driven = Window & { syntheticHost: SyntheticHost };
const SERVICE = "/src/services/hostRequests.ts";
const UI_STORE = "/src/state/ui.ts";
const WALK = process.env.ROTLI_WALK_DIR;

const snap = (page: Page, name: string) =>
  WALK ? page.screenshot({ path: `${WALK}/${name}.png` }) : Promise.resolve();

async function withSyntheticHost(page: Page) {
  await page.route("**/", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      '<script type="module" src="/src/main.tsx">',
      '<script type="module" src="/e2e/host-panes.fixture.ts"></script>$&',
    );
    await route.fulfill({ response, body });
  });
  await gotoApp(page);
}

/** What `rotli:open-settings` with `id` does on the page. */
const requestSettings = (page: Page, id: string) =>
  page.evaluate(async ([url, pane]) => (await import(url!)).openSettingsFromHost(pane), [SERVICE, id]);

const settingsOpen = (page: Page) =>
  page.evaluate(async (url) => (await import(url)).useUiStore.getState().settingsOpen, UI_STORE);

const heading = (page: Page) => page.locator(".set-banner-title");

async function backToNotes(page: Page) {
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(page.locator(".settings")).toHaveCount(0);
}

test("a host's Settings request lands on a built-in pane and on a host pane", async ({ page }) => {
  await withSyntheticHost(page);
  await snap(page, "host-1-notes-before-request");
  expect(await requestSettings(page, "appearance")).toBe(true);
  await expect(heading(page)).toHaveText("Appearance");
  const nav = page.getByRole("navigation", { name: "Settings sections" });
  await expect(nav.getByRole("button", { name: "Appearance", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await snap(page, "host-2-open-settings-appearance");
  expect(await requestSettings(page, "links")).toBe(true);
  await expect(heading(page)).toHaveText("Links");
  await expect(nav.getByRole("button", { name: "Links", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await snap(page, "host-3-open-settings-host-pane");
});

test("an unknown or hidden pane id does nothing at all", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await withSyntheticHost(page);
  expect(await requestSettings(page, "nowhere")).toBe(false);
  expect(await settingsOpen(page)).toBe(false);
  await expect(page.locator(".settings")).toHaveCount(0);
  // the dev server warns instead of throwing: the request came from outside
  await expect.poll(() => warnings.some((text) => text.includes('"nowhere"'))).toBe(true);
  await snap(page, "host-4-unknown-id-nothing");

  await page.evaluate(() => (window as unknown as Driven).syntheticHost.setReady(false));
  expect(await requestSettings(page, "gated")).toBe(false);
  expect(await settingsOpen(page)).toBe(false);
  await expect(page.locator(".settings")).toHaveCount(0);
  await snap(page, "host-5-hidden-pane-nothing");

  // with Settings already open on a pane, a hidden one leaves it there
  expect(await requestSettings(page, "appearance")).toBe(true);
  await expect(heading(page)).toHaveText("Appearance");
  expect(await requestSettings(page, "gated")).toBe(false);
  await expect(heading(page)).toHaveText("Appearance");
  await snap(page, "host-6-hidden-pane-while-open-stays");
  await backToNotes(page);
});

test("a notice held during a cold launch shows once the page listens", async ({ page }) => {
  await withSyntheticHost(page);
  const sentence = "This file is in a folder Rotli uses as a vault, so this app won't open it.";
  await expect(page.locator(".sb-error")).toHaveCount(0);
  await snap(page, "host-7-before-page-ready");
  // Rust held the notice and a Settings request until the page listened
  const order = await page.evaluate(
    async ([url, notice]) => {
      const service = await import(url!);
      const log: string[] = [];
      service.attachPageRequests(service.MAIN_PAGE_HANDLERS, {
        listenHere: async (event: string) => {
          log.push(`listen ${event}`);
          return () => {};
        },
        ready: async () => {
          log.push("ready");
          return { notices: [notice], settings: [] };
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      return log;
    },
    [SERVICE, sentence],
  );
  expect(order).toEqual(["listen rotli:open-notice", "listen rotli:open-settings", "ready"]);
  await expect(page.locator(".sb-error-text")).toHaveText(`⚠ ${sentence}`);
  await snap(page, "host-8-cold-notice-shown");
});
