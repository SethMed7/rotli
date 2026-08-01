// Scoped invalidation acceptance (perf audit 2026-07-30, #1): typing in a note
// must trigger ZERO refetches of the ["notes"]/["note"] namespaces per 400ms
// sync tick — the editor patches the fresh note into the caches instead. A
// structural op (creating a note) still refetches, proving invalidation is
// scoped, not disabled. Observed through the DEV-exposed __rotli.queryClient.

import { expect, test } from "@playwright/test";

import { gotoApp } from "./support";

declare global {
  interface Window {
    __rotli?: {
      queryClient: {
        getQueryCache: () => {
          subscribe: (fn: (event: unknown) => void) => () => void;
        };
      };
    };
    __noteFetches?: number;
  }
}

function armFetchCounter() {
  const rotli = (window as Window).__rotli;
  if (!rotli?.queryClient) {
    throw new Error(
      "__rotli.queryClient is missing — this spec needs the DEV hook (run against `vite dev`, not a production build)",
    );
  }
  return rotli.queryClient.getQueryCache().subscribe((event) => {
    const e = event as { type?: string; action?: { type?: string }; query?: { queryKey?: unknown[] } };
    const key = e.query?.queryKey?.[0];
    if (e.type === "updated" && e.action?.type === "fetch" && (key === "notes" || key === "note")) {
      window.__noteFetches = (window.__noteFetches ?? 0) + 1;
    }
  });
}

test("typing never refetches the notes universe; a structural op still does", async ({ page }) => {
  await gotoApp(page);

  // caret into the welcome note's body (click lands mid-document)
  const editor = page.locator(".cm-content").first();
  await editor.click();

  await page.evaluate(() => {
    window.__noteFetches = 0;
  });
  await page.evaluate(armFetchCounter);

  // several keystrokes + enough time for the 400ms debounced sync to land
  await page.keyboard.type("scoped invalidation proof", { delay: 30 });
  await page.waitForTimeout(1400);

  expect(await page.evaluate(() => window.__noteFetches)).toBe(0);

  // structural op: a NEW note must still ripple a real refetch
  await page.getByRole("button", { name: /^New note in/ }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__noteFetches), { timeout: 5_000 })
    .toBeGreaterThan(0);
});
