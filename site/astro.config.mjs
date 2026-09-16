import { readdirSync, readFileSync } from "node:fs";
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
        if (offenders.length > 0) {
          throw new Error(
            `Inline styles would be blocked by the production Content-Security-Policy (style-src 'self'):\n  ${offenders.join("\n  ")}\nMove them into component <style> rules (Astro extracts those into a stylesheet).`,
          );
        }
      },
    },
  };
}

// Minimal static build. Which pages exist, whether downloads are offered, and
// the canonical origin all come from src/site.ts (SITE_MODE + SITE_URL).
export default defineConfig({
  site: site.url,
  // Never inline a stylesheet into a <style> block: the production CSP allows
  // only external stylesheets, and Astro's default inlines small ones (the 404
  // page shipped unstyled that way). The guard below proves it.
  build: { inlineStylesheets: "never" },
  integrations: [
    ...(site.indexable ? [sitemap({ filter: (page) => page !== `${site.url}/404/` })] : []),
    cspInlineStyleGuard(),
  ],
});
