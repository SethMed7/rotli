// Rotli Web's privacy promise, proven: through setup, writing, reloads,
// Settings, and chat setup, the page asks for nothing but its own files and
// Rotli Helper on 127.0.0.1. No note, title, path, or token goes anywhere
// else — not to a CDN, not to analytics, not to the site's own server (the
// site serves static files; it has no endpoint that takes data). The
// production CSP enforces the same rule in the browser (site/Caddyfile,
// scripts/check-web-privacy.mjs); this spec proves the app never even asks.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { type BrowserContext, expect, test } from "@playwright/test";

import { budgetXlsx, letterDocx } from "./office-fixtures";
import { APP, plantOpfsBinary, plantOpfsFiles, readOpfsBase64, startWithVault } from "./support";

/** Every request that actually LEFT the page, as URLs. A request the
 * browser's content policy stopped before sending (Chromium reports it as
 * failed with "csp") never reached the network, so it isn't one. */
function recordRequests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on("request", (request) => urls.push(request.url()));
  context.on("requestfailed", (request) => {
    if (!/csp/i.test(request.failure()?.errorText ?? "")) return;
    const at = urls.lastIndexOf(request.url());
    if (at >= 0) urls.splice(at, 1);
  });
  return urls;
}

/** The files the build ships: the only same-origin paths the app may load.
 * A URL a note made up (`/app/?note=…`, `/app/private-text`) is not one of
 * them, so a request for it fails the test even though it stays same-origin. */
function shippedPaths(): Set<string> {
  const dist = join(process.cwd(), "dist");
  const out = new Set(["/app/", "/app/index.html"]);
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.add(`/app/${relative(dist, path).split("\\").join("/")}`);
    }
  };
  walk(dist);
  return out;
}

/** What a request may be: a shipped file of the app (no query string) or the
 * helper on loopback. Anything else is an egress. */
function egress(urls: readonly string[], origin: string): string[] {
  const shipped = shippedPaths();
  return urls.filter((url) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    if (url.startsWith("http://127.0.0.1:")) return false;
    if (!url.startsWith(`${origin}/`)) return true;
    const parsed = new URL(url);
    return parsed.search !== "" || !shipped.has(parsed.pathname);
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

// Adversarial review, 2026-09-22: the page policy allows 'self', so a note
// could try to smuggle its text to the site in an image request, or from an
// ```html fence. Neither may leave a single request behind.
test("a note's images and HTML can't send its text anywhere, not even to this site", async ({
  context,
  page,
  baseURL,
}) => {
  const urls = recordRequests(context);
  const origin = new URL(baseURL ?? APP).origin;
  await startWithVault(page);
  await plantOpfsFiles(page, {
    "wiki/leak.md": [
      "# Leak attempt",
      "",
      "```mermaid",
      "flowchart LR",
      'A@{ img: "/app/index.html?note=secret-mermaid-text", w: 40, h: 40 }',
      "```",
      "",
      `![x](${origin}/app/?note=secret-image-text)`,
      "",
      "```html",
      `<img src="${origin}/app/secret-fence-text.png"><div style="background:url(${origin}/app/secret-css-text)">x</div>`,
      "```",
      "",
    ].join("\n"),
  });
  await page.reload();
  await page.locator(".main-tree, .sb-foot").first().waitFor();
  await page
    .getByRole("button", { name: /Search/ })
    .first()
    .click();
  await page.keyboard.type("Leak attempt");
  // Enter opens the top result: wait until the planted note is it (a slow
  // runner can still be indexing the reloaded folder, and Welcome wins)
  await expect(page.getByRole("option").first()).toContainText("Leak attempt", { timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Leak attempt");
  await expect(page.locator(".rotli-render-mermaid")).toContainText("privacy");
  expect(urls.filter((url) => url.includes("secret"))).toEqual([]);
  expect(egress(urls, origin)).toEqual([]);
});

// The office editors (2026-10-12, Rotli Web Beta): opening, typing into, and
// saving a Word document and an Excel workbook loads only the app's own
// files — no font, worker, or converter is fetched from anywhere else.
test("opening and editing a document and a workbook never leaves this computer", async ({
  context,
  page,
  baseURL,
}) => {
  const urls = recordRequests(context);
  const posts: string[] = [];
  context.on("request", (request) => {
    if (request.method() !== "GET" && !request.url().startsWith("http://127.0.0.1:"))
      posts.push(request.url());
  });
  await startWithVault(page);
  const xlsx = (await budgetXlsx()).toString("base64");
  const docx = (await letterDocx()).toString("base64");
  await plantOpfsBinary(page, { "storage/budget.xlsx": xlsx, "storage/letter.docx": docx });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const open = async (path: string) => {
    await page.locator(".sb-system .frow", { hasText: "Assets" }).click();
    await page.locator(`.system-browser [data-note-id="${path}"]`).first().dblclick();
  };

  await open("storage/budget.xlsx");
  await expect(page.locator(".sheet-editor canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".sheet-editor"))).toBe(true);
  await page.keyboard.type("private cell");
  await page.keyboard.press("Enter");
  await expect.poll(() => readOpfsBase64(page, "storage/budget.xlsx")).not.toBe(xlsx);

  await open("storage/letter.docx");
  const canvas = page.locator(".document-editor-host.is-ready canvas").first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the document canvas has no bounds");
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.keyboard.press("End");
  await page.keyboard.type(" private paragraph");
  await expect.poll(() => readOpfsBase64(page, "storage/letter.docx")).not.toBe(docx);

  expect(egress(urls, new URL(baseURL ?? APP).origin)).toEqual([]);
  expect(posts).toEqual([]);
  expect(urls.filter((url) => url.includes("private"))).toEqual([]);
});
