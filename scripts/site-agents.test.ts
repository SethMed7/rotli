// The agent-facing site contract (site/src/agents.ts + site/Caddyfile): what
// robots.txt and llms.txt say, and how Caddy serves the Markdown twins. The
// negotiation only exists under Caddy, so its directives are pinned here; a
// Caddyfile edit that drops one fails CI instead of shipping the wrong type.
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const caddyfile = readFileSync(join(import.meta.dir, "..", "site", "Caddyfile"), "utf8");
const collapse = (text: string) => text.replace(/\s+/g, " ");

// the site's own types (astro:content) stay out of the root typecheck: a
// computed path, and only the two functions under test
let agents: {
  robotsText(): string;
  llmsText(writing: { resources: never[]; posts: never[] }): string;
};

beforeAll(async () => {
  process.env.SITE_MODE = "full";
  process.env.SITE_URL = "https://rotli.co";
  process.env.SOURCE_REPOSITORY_PUBLIC = "true";
  // writing.ts reads Astro's content collections; these tests pass entries in
  mock.module("astro:content", () => ({ getCollection: async () => [] }));
  agents = (await import(join(import.meta.dir, "..", "site", "src", "agents.ts"))) as typeof agents;
});

describe("Caddy serves the Markdown twins", () => {
  test("a request that asks for Markdown gets the page's twin, typed as Markdown", () => {
    const flat = collapse(caddyfile);
    expect(flat).toContain("@markdown { header Accept *text/markdown* file {path}index.md }");
    expect(flat).toContain('header @markdown Content-Type "text/markdown; charset=utf-8"');
    expect(flat).toContain("rewrite @markdown {file_match.relative}");
  });

  test("a cache keeps HTML and Markdown apart, and llms.txt reads inline", () => {
    const flat = collapse(caddyfile);
    expect(flat).toContain("header Vary Accept");
    expect(flat).toContain('@llms path /llms.txt header @llms Content-Type "text/plain; charset=utf-8"');
    expect(flat).toContain(
      '@markdownFile path *.md header @markdownFile Content-Type "text/markdown; charset=utf-8"',
    );
  });
});

describe("the update check through rotli.co (2026-10-01)", () => {
  test("a well-formed version path redirects to the signed GitHub feed, and only that", () => {
    const flat = collapse(caddyfile);
    expect(flat).toContain(
      "@updateCheck path_regexp ^/update/[0-9][0-9A-Za-z.+%-]{0,31}/[a-z0-9_-]{1,32}/[a-z0-9_-]{1,16}/latest\\.json$",
    );
    expect(flat).toContain(
      "redir @updateCheck https://github.com/SethMed7/rotli-releases/releases/latest/download/latest.json 302",
    );
  });
});

describe("robots.txt", () => {
  test("names each AI crawler; the ones the zone blocks stay disallowed", () => {
    const robots = agents.robotsText();
    for (const agent of ["GPTBot", "ClaudeBot", "CCBot", "Bytespider"]) {
      expect(robots).toContain(`User-agent: ${agent}\nDisallow: /`);
    }
    expect(robots).toContain("User-agent: *\nAllow: /\nDisallow: /app/");
    expect(robots).toContain("https://rotli.co/llms.txt");
    expect(robots).toContain("Sitemap: https://rotli.co/sitemap-index.xml");
  });
});

describe("llms.txt", () => {
  test("a title, a summary, then the site's pages", () => {
    const text = agents.llmsText({ resources: [], posts: [] });
    expect(text.startsWith("# rotli\n\n> ")).toBe(true);
    for (const page of ["/features/", "/privacy/", "/download/", "/changelog/", "/about/"]) {
      expect(text).toContain(`(https://rotli.co${page})`);
    }
    expect(text).toContain("The source is open under the MIT license.");
  });
});
