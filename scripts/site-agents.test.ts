// The agent-facing site contract (site/src/agents.ts + site/Caddyfile): what
// robots.txt and llms.txt say, and how Caddy serves the Markdown twins. The
// negotiation only exists under Caddy, so its directives are pinned here; a
// Caddyfile edit that drops one fails CI instead of shipping the wrong type.
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const caddyfile = readFileSync(join(import.meta.dir, "..", "site", "Caddyfile"), "utf8");
const collapse = (text: string) => text.replace(/\s+/g, " ");

// the site's own types (astro:content) stay out of the root typecheck: a
// computed path, and only the two functions under test
type RoadmapSections = {
  title: string;
  slug: string;
  items: { id: string; title: string; size: string | null; summary: string }[];
}[];

let agents: {
  robotsText(): string;
  llmsText(writing: { posts: never[] }): string;
  llmsFullText(content: { posts: never[]; roadmap: RoadmapSections }): string;
  featureGraph(feature: { id: string; name: string; line: string }): Record<string, unknown>[];
  application(): Record<string, unknown>;
  roadmapMarkdown(sections: RoadmapSections): string;
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

  test("a cache keeps HTML and Markdown apart, and both llms files read inline", () => {
    const flat = collapse(caddyfile);
    expect(flat).toContain("header Vary Accept");
    expect(flat).toContain(
      '@llms path /llms.txt /llms-full.txt header @llms Content-Type "text/plain; charset=utf-8"',
    );
    expect(flat).toContain(
      '@markdownFile path *.md header @markdownFile Content-Type "text/markdown; charset=utf-8"',
    );
  });
});

// The guides joined the blog on 2026-10-06 (tagged Guide). Their old /resources/<slug>/ addresses
// redirect twice over: Astro's refresh pages (astro.config.mjs MOVED_GUIDES, proven in
// e2e/site/guides-moved.spec.ts) and, in production, Caddy's permanent redirect, which only exists
// under Caddy and is pinned here. Both lists must be exactly the guides on disk.
describe("the guides' old addresses (2026-10-06)", () => {
  const postsDir = join(import.meta.dir, "..", "site", "src", "content", "writing", "posts");
  const guides = readdirSync(postsDir)
    .filter((file) => file.endsWith(".md"))
    .filter((file) => /^tags: \[Guide\b/m.test(readFileSync(join(postsDir, file), "utf8")))
    .map((file) => file.replace(/\.md$/, ""))
    .sort();

  test("the guides are on disk as posts, and nothing is left under resources/", () => {
    expect(guides).toEqual([
      "ai-and-your-notes",
      "getting-started",
      "rotli-helper",
      "web-and-mac",
      "why-local",
    ]);
    expect(() => readdirSync(join(postsDir, "..", "resources"))).toThrow();
  });

  test("Astro's redirects and Caddy's name exactly those guides, twins included", () => {
    const config = readFileSync(join(import.meta.dir, "..", "site", "astro.config.mjs"), "utf8");
    const listed = JSON.parse(config.match(/export const MOVED_GUIDES = (\[[^\]]*\]);/)![1]!) as string[];
    expect([...listed].sort()).toEqual(guides);
    const flat = collapse(caddyfile);
    const regex = flat.match(/@movedGuide path_regexp movedGuide (\S+)/)![1]!;
    expect(regex).toBe(`^/resources/(${listed.join("|")})(/.*)?$`);
    expect(flat).toContain("redir @movedGuide /blog/{re.movedGuide.1}{re.movedGuide.2} permanent");
    const pattern = new RegExp(regex);
    expect("/resources/rotli-helper/index.md".replace(pattern, "/blog/$1$2")).toBe(
      "/blog/rotli-helper/index.md",
    );
    expect("/resources/why-local/".replace(pattern, "/blog/$1$2")).toBe("/blog/why-local/");
    expect(pattern.test("/resources/developers/")).toBe(false);
    expect(pattern.test("/resources/")).toBe(false);
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
  // The owner turned off Cloudflare's AI-bot blocking on 2026-10-12: training crawlers are welcome.
  test("names each AI crawler and welcomes every one, training crawlers included", () => {
    const robots = agents.robotsText();
    for (const agent of ["GPTBot", "ClaudeBot", "CCBot", "Bytespider", "OAI-SearchBot", "Claude-User"]) {
      expect(robots).toContain(`User-agent: ${agent}\nAllow: /\nDisallow: /app/`);
    }
    expect(robots).not.toMatch(/Disallow: \/\n/);
    expect(robots).toContain("User-agent: *\nAllow: /\nDisallow: /app/");
    expect(robots).toContain("https://rotli.co/llms.txt");
    expect(robots).toContain("Sitemap: https://rotli.co/sitemap-index.xml");
  });
});

describe("llms.txt", () => {
  test("a title, a summary, then the site's pages", () => {
    const text = agents.llmsText({ posts: [] });
    expect(text.startsWith("# rotli\n\n> ")).toBe(true);
    for (const page of ["/features/", "/privacy/", "/download/", "/changelog/", "/about/"]) {
      expect(text).toContain(`(https://rotli.co${page})`);
    }
    expect(text).toContain("The source is open under the MIT license.");
  });

  test("lists the guides apart from the other posts, each by its Markdown twin", () => {
    const entry = (id: string, title: string, tags: string[]) =>
      ({
        id: `posts/${id}`,
        data: { title, description: `About ${title}.`, tags, section: "post" },
      }) as never;
    const text = agents.llmsText({
      posts: [entry("why-local", "Why local?", ["Guide", "Privacy"]), entry("a-post", "A post", ["AI"])],
    });
    const guides = text.indexOf("## Guides");
    const blog = text.indexOf("## Blog");
    expect(guides).toBeGreaterThan(0);
    expect(blog).toBeGreaterThan(guides);
    expect(text).toContain("- [Why local?](https://rotli.co/blog/why-local/index.md): About Why local?.");
    expect(text.indexOf("[A post](https://rotli.co/blog/a-post/index.md)")).toBeGreaterThan(blog);
    expect(text).not.toContain("/resources/why-local/");
  });

  test("points agents at the developers page and the one-file version", () => {
    const text = agents.llmsText({ posts: [] });
    expect(text).toContain("[Developers](https://rotli.co/resources/developers/)");
    // the launch site: MCP is still a development-build feature (ROADMAP.md agents-mcp)
    expect(text).toContain("MCP for agents like Claude Code and Codex is coming soon");
    expect(text).toContain("[Everything in one file](https://rotli.co/llms-full.txt)");
  });

  test("links the roadmap's Markdown twin, which lists each item with its size", () => {
    expect(agents.llmsText({ posts: [] })).toContain("[Roadmap](https://rotli.co/roadmap/index.md)");
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
      "/blog/rotli-helper/",
      "/blog/rotli-web-and-your-mac/",
    ]);
    const content = join(siteRoot, "src", "content", "writing");
    expect(readFileSync(join(content, "posts", "rotli-helper.md"), "utf8")).toContain("Rotli Helper");
    expect(readFileSync(join(content, "posts", "rotli-web-and-your-mac.md"), "utf8")).toContain("Terminal");
  });

  test("with Rotli Web off, the question isn't asked", () => {
    expect(questionsWith(false).some((item) => item.q.includes("browser"))).toBe(false);
  });
});

describe("llms-full.txt", () => {
  const roadmap = [
    {
      title: "Planned",
      slug: "planned",
      items: [{ id: "x", title: "Charts", size: "L", summary: "Type `/chart`." }],
    },
  ];

  test("opens like llms.txt, then every feature, answer, and roadmap item in full", () => {
    const text = agents.llmsFullText({ posts: [], roadmap });
    expect(text.startsWith("# rotli\n\n> ")).toBe(true);
    expect(text).toContain("https://rotli.co/privacy/index.md");
    expect(text).toContain("# Everything rotli does");
    expect(text).toContain("### A command line for scripts\n\nAvailable on Mac.");
    expect(text).toContain('- `rotli notes search "launch plan"`: Search the vault.');
    expect(text).toContain("Page: https://rotli.co/features/command-line/");
    expect(text).toContain("# Questions people ask");
    expect(text).toContain("- **Charts** (L): Type `/chart`.");
    // the launch site leaves development-only entries out, as its catalog does
    expect(text).not.toContain("### MCP for AI agents");
  });

  test("each post follows in full, after a rule", () => {
    const post = {
      id: "posts/why-local",
      body: "## Your files\n\nThey stay yours.",
      data: { title: "Why local?", description: "Files first.", tags: ["Guide"], section: "post" },
    } as never;
    const text = agents.llmsFullText({ posts: [post], roadmap });
    expect(text).toContain("---\n\n# Why local?\n\n> Files first.\n\n## Your files\n\nThey stay yours.");
    expect(text).toContain("Source: https://rotli.co/blog/why-local/");
  });
});

describe("JSON-LD", () => {
  test("a feature page says what it is about and where it sits", () => {
    const [page, crumbs] = agents.featureGraph({
      id: "tasks",
      name: "Tasks that stay text",
      line: "Checkboxes.",
    });
    expect(page).toMatchObject({
      "@type": "WebPage",
      name: "Tasks that stay text",
      url: "https://rotli.co/features/tasks/",
      about: { "@type": "SoftwareApplication", name: "rotli" },
    });
    expect(JSON.stringify(crumbs)).toContain('"item":"https://rotli.co/features/"');
  });

  test("the application lists what has shipped, and nothing still in development", () => {
    const list = agents.application().featureList as string[];
    expect(list).toContain("A command line for scripts");
    expect(list).not.toContain("MCP for AI agents");
    expect(list).not.toContain("Charts from your notes");
  });
});

// The build guard (astro.config.mjs, rotli-agent-files-guard) checks these files exist in dist.
describe("the addresses the agent files send agents to", () => {
  test("Markdown links and bare Page: lines, without trailing punctuation, as build files", async () => {
    const { agentLinkTargets } = (await import(
      join(import.meta.dir, "..", "site", "src", "agentLinks.ts")
    )) as { agentLinkTargets: (text: string, origin: string) => { href: string; file: string }[] };
    const text = [
      "- [Features](https://rotli.co/features/): every feature",
      "Page: https://rotli.co/features/markdown/.",
      "Run https://rotli.co/helper/install.sh; then https://rotli.co/privacy/index.md, done.",
      "Open https://rotli.co/app/ or https://github.com/SethMed7/rotli and http://rotli.co/x/",
      "A space: https://rotli.co/blog/a%20b/",
    ].join("\n");
    expect(agentLinkTargets(text, "https://rotli.co").map(({ file }) => file)).toEqual([
      "/features/index.html",
      "/features/markdown/index.html",
      "/helper/install.sh",
      "/privacy/index.md",
      "/blog/a b/index.html",
    ]);
  });
});
