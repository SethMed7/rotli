// Rotli Web's privacy promise, proven: through setup, writing, reloads,
// Settings, and chat setup, the page asks for nothing but its own files and
// Rotli Helper on 127.0.0.1. No note, title, path, or token goes anywhere
// else — not to a CDN, not to analytics, not to the site's own server (the
// site serves static files; it has no endpoint that takes data). The
// production CSP enforces the same rule in the browser (site/Caddyfile,
// scripts/check-web-privacy.mjs); this spec proves the app never even asks.

import { type BrowserContext, expect, test } from "@playwright/test";

import { APP, startWithVault } from "./support";

/** Every request the context makes, as URLs. */
function recordRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on("request", (request) => urls.push(request.url()));
  return urls;
}

/** What a request may be: the app's own static files (GET, same origin) or
 * the helper on loopback. Anything else is an egress. */
function egress(urls: readonly string[], origin: string): string[] {
  return urls.filter((url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    if (url.startsWith("http://127.0.0.1:")) return false;
    return !url.startsWith(`${origin}/`);
  });
}

test("setup, writing, reloads, Settings, and chat setup never leave this computer", async ({
  context,
  page,
  baseURL,
}) => {
  const urls = recordRequests(context);
  const posts: string[] = [];
  context.on("request", (request) => {
    // the site takes no data: nothing but the helper is ever sent a body
    if (request.method() !== "GET" && !request.url().startsWith("http://127.0.0.1:"))
      posts.push(request.url());
  });
  await startWithVault(page);
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" private words");
  await page.reload();
  await expect(page.locator(".cm-content").first()).toContainText("private words");
  await page
    .getByRole("button", { name: /Settings/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Rotli Web" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".sb-switch-seg.desktop-only").click();
  await expect(page.getByRole("dialog", { name: "Chat on the web" })).toBeVisible();

  expect(egress(urls, new URL(baseURL ?? APP).origin)).toEqual([]);
  expect(posts).toEqual([]);
  // and no request URL ever carries what was typed
  expect(urls.filter((url) => url.includes("private"))).toEqual([]);
});
