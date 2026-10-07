import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

import { movedFeatures } from "./src/features";
import { figurePlugin } from "./src/figures";
import { votableIds } from "./src/roadmap";
import { readRoadmapFile } from "./src/roadmap-file";
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
            `Built styles would break in production:\n  ${offenders.join("\n  ")}\nInline styles are blocked by the Content-Security-Policy (style-src 'self'): move them into component <style> rules. A literal :global( left in built CSS is dropped by the browser: move that rule into <style is:global>.`,
          );
        }
      },
    },
  };
}

/**
 * A ```figure fence in a post is a chart or a small diagram, drawn at build time
 * (src/figures.ts): no chart library and no inline style reach the page. Astro's
 * Markdown processor (Sätteri) takes its plugins on the processor's own options,
 * which integrations may extend; anything else fails here instead of shipping
 * the fence as a code block.
 */
function figures() {
  return {
    name: "rotli-figures",
    hooks: {
      "astro:config:setup": ({ config }) => {
        const processor = config.markdown.processor;
        if (processor?.name !== "satteri" || !Array.isArray(processor.options?.mdastPlugins))
          throw new Error(`rotli-figures expects Astro's Sätteri Markdown processor, found ${processor?.name}`);
        processor.options.mdastPlugins.push(figurePlugin);
      },
    },
  };
}

/**
 * The agent-facing files (src/agents.ts) are only useful if they are true to
 * the build: every link in /llms.txt must land on a page this build emitted
 * (agents follow them literally), and every JSON-LD block must parse. A page
 * renamed without updating the summary fails here, not on rotli.co.
 */
function agentFilesGuard() {
  return {
    name: "rotli-agent-files-guard",
    hooks: {
      "astro:build:done": ({ dir }) => {
        const root = fileURLToPath(dir);
        const problems = [];
        const llms = join(root, "llms.txt");
        if (!existsSync(llms)) problems.push("llms.txt was not emitted");
        else {
          for (const [, href] of readFileSync(llms, "utf8").matchAll(/\]\((https?:[^)\s]+)\)/g)) {
            const url = new URL(href);
            if (url.origin !== site.url) continue;
            const file = join(
              root,
              decodeURIComponent(url.pathname),
              url.pathname.endsWith("/") ? "index.html" : "",
            );
            if (!existsSync(file)) problems.push(`llms.txt links ${href}, which this build did not emit`);
          }
        }
        const walk = (folder) => {
          for (const entry of readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".html")) {
              const html = readFileSync(path, "utf8");
              for (const [, body] of html.matchAll(
                /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
              )) {
                try {
                  JSON.parse(body);
                } catch (error) {
                  problems.push(`${path.slice(root.length)}: JSON-LD does not parse (${error.message})`);
                }
              }
            }
          }
        };
        walk(root);
        if (problems.length > 0)
          throw new Error(`Agent-facing files are out of step with the build:\n  ${problems.join("\n  ")}`);
      },
    },
  };
}

/**
 * /roadmap/ is ROADMAP.md rendered (src/roadmap.ts), and votes attach to item ids,
 * so the built page must carry every votable id from the file exactly once, and
 * nothing else. Parsing the file already fails on a missing or repeated id; this
 * catches a page that drops, repeats, or invents an item.
 */
function roadmapGuard() {
  return {
    name: "rotli-roadmap-guard",
    hooks: {
      "astro:build:done": ({ dir }) => {
        if (!site.showsFullSite) return;
        const page = join(fileURLToPath(dir), "roadmap", "index.html");
        if (!existsSync(page)) throw new Error("The roadmap page was not emitted (src/pages/roadmap/).");
        const html = readFileSync(page, "utf8");
        const onPage = [...html.matchAll(/data-roadmap-item="([^"]+)"/g)].map((match) => match[1]);
        const inFile = votableIds(readRoadmapFile());
        const problems = [
          ...inFile.filter((id) => !onPage.includes(id)).map((id) => `"${id}" is in ROADMAP.md but not on the page`),
          ...onPage.filter((id) => !inFile.includes(id)).map((id) => `"${id}" is on the page but not in ROADMAP.md`),
          ...onPage.filter((id, index) => onPage.indexOf(id) !== index).map((id) => `"${id}" appears twice on the page`),
        ];
        if (problems.length > 0) throw new Error(`/roadmap/ and ROADMAP.md disagree:\n  ${problems.join("\n  ")}`);
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

/** The guides that lived at /resources/<slug>/ until 2026-10-06, now /blog/<slug>/. The
 * Caddyfile's `movedGuide` matcher lists the same slugs (scripts/site-agents.test.ts holds both). */
export const MOVED_GUIDES = ["getting-started", "why-local", "ai-and-your-notes", "rotli-helper", "web-and-mac"];

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
  // The MCP guide folded into /resources/developers/ (2026-10-02), and the
  // guides joined the blog as posts tagged Guide (2026-10-06). The static build
  // writes a small refresh page at each old address (any host, `astro
  // preview`, the e2e lane); in production the Caddyfile answers the same
  // addresses, Markdown twins included, with a permanent redirect first. The
  // feature catalog was condensed the same day: each entry folded into another
  // redirects to its section there (src/features.ts movedFeatures).
  redirects: site.showsFullSite
    ? {
        "/resources/mcp": "/resources/developers/",
        ...Object.fromEntries(MOVED_GUIDES.map((slug) => [`/resources/${slug}`, `/blog/${slug}/`])),
        ...movedFeatures(),
      }
    : {},
  vite: { server: { proxy: localWebApp }, preview: { proxy: localWebApp } },
  integrations: [
    figures(),
    ...(site.indexable ? [sitemap({ filter: (page) => page !== `${site.url}/404/` && page !== `${site.url}/subscribed/` })] : []),
    cspInlineStyleGuard(),
    agentFilesGuard(),
    roadmapGuard(),
  ],
});
