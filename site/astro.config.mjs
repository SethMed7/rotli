import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

import { site } from "./src/site";

/**
 * Production serves every page under `style-src 'self'` (site/Caddyfile), so an
 * inline `style="…"` attribute or `<style>` block renders unstyled on rotli.co
 * while looking fine in `astro dev` and `astro preview`, which send no CSP.
 * Astro extracts component styles into files; anything left inline is a bug.
 * Fail the build (locally, in CI, and in the Railway image) instead of shipping it.
 */
function cspInlineStyleGuard() {
  return {
    name: "rotli-csp-inline-style-guard",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const root = fileURLToPath(dir);
        const offenders = [];
        const walk = (folder) => {
          for (const entry of readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".html")) {
              const html = readFileSync(path, "utf8");
              const inline = html.match(/<[a-z][^>]*\sstyle="[^"]*"/gi) ?? [];
              const blocks = html.match(/<style[\s>]/gi) ?? [];
              if (inline.length > 0 || blocks.length > 0) {
                offenders.push(
                  `${path.slice(root.length)}: ${inline.length} style attribute(s), ${blocks.length} <style> block(s)`,
                );
              }
            }
          }
        };
        walk(root);
        // A `:global(...)` that survives into the built CSS was never transformed (Astro does
        // not rewrite it inside `:has()` and similar), so the browser drops the whole rule.
        const cssDir = join(root, "_astro");
        if (existsSync(cssDir)) {
          for (const name of readdirSync(cssDir)) {
            if (name.endsWith(".css") && readFileSync(join(cssDir, name), "utf8").includes(":global(")) {
              offenders.push(`_astro/${name}: a literal :global( survived the build (move the rule into <style is:global>)`);
            }
          }
        }
        if (offenders.length > 0) {
          throw new Error(
            `Inline styles would be blocked by the production Content-Security-Policy (style-src 'self'):\n  ${offenders.join("\n  ")}\nMove them into component <style> rules (Astro extracts those into a stylesheet).`,
          );
        }
      },
    },
  };
}

/**
 * Locally there is no Caddy and no Docker `app` stage, so `/app/` (Rotli Web)
 * has nothing behind it and "Open in browser" landed on the 404 page. Dev and
 * preview pass `/app/` through to the web app's own dev server
 * (`bun run dev:web` at the repository root, port 1437, already based at
 * /app/), so the button works on the same origin as it does on rotli.co. When
 * that server is not running, say so instead of a bare proxy error. Build
 * output is untouched: this is server config only.
 */
const WEB_APP_DEV_ORIGIN = "http://localhost:1437";
// Keyed "/app/" (with the slash): a bare "/app" prefix also matched
// /apple-touch-icon.png and proxied the icon away.
const localWebApp = {
  "/app/": {
    target: WEB_APP_DEV_ORIGIN,
    ws: true,
    configure: (proxy) => {
      proxy.on("error", (_error, _request, response) => {
        if (!("writeHead" in response) || response.headersSent) return;
        response.writeHead(503, { "content-type": "text/html; charset=utf-8" });
        response.end(
          `<!doctype html><meta charset="utf-8"><title>Rotli Web is not running locally</title>` +
            `<body><h1>Rotli Web is not running locally</h1>` +
            `<p>On rotli.co the web app is served from <code>/app/</code>. Here it comes from its dev server: ` +
            `run <code>bun run dev:web</code> at the repository root, then reload.</p></body>`,
        );
      });
    },
  },
};

// Minimal static build. Which pages exist, whether downloads are offered, and
// the canonical origin all come from src/site.ts (SITE_MODE + SITE_URL).
export default defineConfig({
  // No syntax highlighter: Shiki writes inline style= attributes, which the
  // production CSP (style-src 'self') drops. Code blocks are styled by class.
  markdown: { syntaxHighlight: false },
  site: site.url,
  // Never inline a stylesheet into a <style> block: the production CSP allows
  // only external stylesheets, and Astro's default inlines small ones (the 404
  // page shipped unstyled that way). The guard below proves it.
  build: { inlineStylesheets: "never" },
  vite: { server: { proxy: localWebApp }, preview: { proxy: localWebApp } },
  integrations: [
    ...(site.indexable ? [sitemap({ filter: (page) => page !== `${site.url}/404/` })] : []),
    cspInlineStyleGuard(),
  ],
});
