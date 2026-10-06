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
  roadmapMarkdown(
    sections: {
      title: string;
      slug: string;
      items: { id: string; title: string; size: string | null; summary: string }[];
    }[],
  ): string;
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

  test("links the roadmap's Markdown twin, which lists each item with its size", () => {
    expect(agents.llmsText({ resources: [], posts: [] })).toContain(
      "[Roadmap](https://rotli.co/roadmap/index.md)",
    );
    const twin = agents.roadmapMarkdown([
      {
        title: "In the work",
        slug: "in-the-work",
        items: [{ id: "charts", title: "Charts", size: "L", summary: "Type `/chart`." }],
      },
      {
        title: "Ideas",
        slug: "ideas",
        items: [{ id: "x", title: "No size", size: null, summary: "Just an idea." }],
      },
    ]);
    expect(twin).toContain("## In the work\n\n- **Charts** (L): Type `/chart`.");
    expect(twin).toContain("- **No size**: Just an idea.");
    expect(twin).toContain("https://rotli.co/roadmap/");
  });
});

// The landing FAQ is also the FAQPage JSON-LD (agents.ts maps each { q, a }). Rotli Web and the
// Helper are answered there only while WEB_APP_ENABLED (since the tour that held them was
// removed, 2026-10-06), and the env is read once per process, so each build runs in its own.
describe("the FAQ's Rotli Web answer", () => {
  const siteRoot = join(import.meta.dir, "..", "site");
  type Question = { q: string; a: string; links?: { href: string; label: string }[] };
  const questionsWith = (web: boolean): Question[] => {
    const run = Bun.spawnSync(
      [
        "bun",
        "-e",
        'const { questions } = await import("./src/faq.ts"); console.log(JSON.stringify(questions));',
      ],
      { cwd: siteRoot, env: { ...process.env, WEB_APP_ENABLED: web ? "true" : "" } },
    );
    expect(run.exitCode).toBe(0);
    return JSON.parse(run.stdout.toString()) as Question[];
  };

  test("with Rotli Web on, one answer says it and links the Helper guide and the Terminal post", () => {
    const browser = questionsWith(true).filter((item) => item.q === "Can I use rotli in my browser?");
    expect(browser).toHaveLength(1);
    const [entry] = browser;
    expect(entry!.a).toContain("your notes stay in a folder on your computer");
    expect(entry!.a).toContain("Rotli Helper");
    expect(entry!.a).toContain("Safari and phones aren’t supported yet");
    // The answer stays plain text (it is the JSON-LD); the links are their own line.
    expect(entry!.a).not.toContain("/");
    expect(entry!.links?.map((link) => link.href)).toEqual([
      "/resources/rotli-helper/",
      "/blog/rotli-web-and-your-mac/",
    ]);
    const content = join(siteRoot, "src", "content", "writing");
    expect(readFileSync(join(content, "resources", "rotli-helper.md"), "utf8")).toContain("Rotli Helper");
    expect(readFileSync(join(content, "posts", "rotli-web-and-your-mac.md"), "utf8")).toContain("Terminal");
  });

  test("with Rotli Web off, the question isn't asked", () => {
    expect(questionsWith(false).some((item) => item.q.includes("browser"))).toBe(false);
  });
});
