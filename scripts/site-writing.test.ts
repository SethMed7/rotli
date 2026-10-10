// The blog's build-time rules, without a browser: figures in posts (site/src/figures.ts: the
// ```figure fence, its SVG and list, its table for the Markdown twin) and how /blog/ arranges
// its posts (site/src/blog.ts: featured, the row under it, the list, "New"). e2e/site/ proves
// the pages. Like site-agents.test.ts, the modules load through a computed path so the site's
// types stay out of the root typecheck; only what is tested is typed here.
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const siteSrc = (...parts: string[]) => join(import.meta.dir, "..", "site", "src", ...parts);

interface BarRow {
  label: string;
  value: string;
  amount: number;
}
interface Figure {
  kind: "bar" | "flow";
  title: string;
  caption: string;
  source?: { label: string; url: string };
  rows?: BarRow[];
  unit?: string;
  max?: number;
  steps?: { name: string; detail: string; options: { name: string; detail: string }[] }[];
}
let figures: {
  parseFigure(source: string): Figure;
  figureHtml(figure: Figure, id: string): string;
  figureMarkdown(figure: Figure): string;
  figuresToMarkdown(markdown: string): string;
  withoutFigures(markdown: string): string;
  figureId(title: string, taken: Set<string>): string;
  scaleMax(figure: Figure): number;
  figurePlugin(): {
    name: string;
    code(
      node: { lang?: string; value: string },
      ctx: { replaceNode(node: unknown, content: { rawHtml: string }): void },
    ): void;
  };
};
interface Post {
  slug: string;
  date: Date;
  featured: boolean;
  tags: string[];
}
let blog: {
  isNew(date: Date, now: Date, days?: number): boolean;
  NEW_FOR_DAYS: number;
  arrangeBlog<T extends { date: Date; featured: boolean; guide?: boolean }>(
    posts: T[],
  ): { featured: T | undefined; secondary: T[]; all: T[] };
  GUIDE: string;
  topicsOf(posts: { tags: string[] }[]): string[];
  topicKey(topic: string): string;
  tocTree(
    items: { slug: string; text: string; depth: number }[],
  ): { slug: string; text: string; children: { slug: string; text: string }[] }[];
  railTitle(title: string): string;
  morePosts<T>(current: T, published: T[], upcoming: T[], count?: number): { item: T; soon: boolean }[];
  MORE_POSTS: number;
};
interface Promo {
  id: string;
  label: string;
  title: string;
  text: string;
  href: string;
  pose: string;
  external?: boolean;
  needs?: "downloads" | "webApp";
}
let promos: {
  PROMOS: Promo[];
  PROMO_LABEL: string;
  RAIL_PROMOS: number;
  availablePromos(promos?: Promo[], offers?: { downloads: boolean; webApp: boolean }): Promo[];
  promosFor(index: number, count?: number, promos?: Promo[]): Promo[];
};
let poses: Record<string, string>;
interface Source {
  number: number;
  publisher: string;
  title: string;
  url?: string;
}
let sources: { sourcesOf(markdown: string): Source[] };

beforeAll(async () => {
  // promos.ts reads src/site.ts, which reads the environment once per process: the same full,
  // public build the other site tests set (site-agents, site-features), whichever loads it first.
  process.env.SITE_MODE = "full";
  process.env.SITE_URL = "https://rotli.co";
  process.env.SOURCE_REPOSITORY_PUBLIC = "true";
  figures = (await import(siteSrc("figures.ts"))) as typeof figures;
  blog = (await import(siteSrc("blog.ts"))) as typeof blog;
  sources = (await import(siteSrc("sources.ts"))) as typeof sources;
  promos = (await import(siteSrc("promos.ts"))) as typeof promos;
  poses = ((await import(siteSrc("og.ts"))) as { POSES: Record<string, string> }).POSES;
});

const BAR = `kind: bar
title: Paying users who hadn't used it
caption: A survey of people.
source: A report | https://example.com/report
label: Tool
value: Unused for 30 days
unit: %
max: 100
---
ChatGPT | 50.4
Claude | 27.2`;

const FLOW = `kind: flow
title: How a note gets filed
caption: In the Mac app.
---
Your note | A plain file
The Librarian | Files it
- Your plan | Claude Code or Codex
- A model on your Mac | No network
Frontmatter | Fields at the top`;

describe("a figure fence", () => {
  test("a bar chart keeps every value exactly as written", () => {
    const figure = figures.parseFigure(BAR);
    expect(figure.kind).toBe("bar");
    expect(figure.rows!.map((row) => row.value)).toEqual(["50.4", "27.2"]);
    expect(figure.source).toEqual({ label: "A report", url: "https://example.com/report" });
  });

  test("a bar chart's SVG is named by its title, described by its values, and sized by percentages", () => {
    const html = figures.figureHtml(figures.parseFigure(BAR), "figure-x");
    expect(html).toContain(`<p class="figure-title" id="figure-x-title">Paying users who hadn't used it</p>`);
    expect(html).toContain('role="img" aria-labelledby="figure-x-title" aria-describedby="figure-x-desc"');
    expect(html).toContain(
      '<desc id="figure-x-desc">Unused for 30 days: ChatGPT 50.4%, Claude 27.2%.</desc>',
    );
    expect(html).toContain('class="chart-bar" x="0" y="26" width="50.4%"');
    expect(html).toContain('class="chart-track"');
    // The numbers again as a table, and the caption cites the source.
    expect(html).toContain('<tr><th scope="row">ChatGPT</th><td>50.4%</td></tr>');
    expect(html).toContain('Source: <a href="https://example.com/report" rel="noopener">A report</a>.');
  });

  test("nothing in a figure needs an inline style or a colour attribute (the CSP and the tokens)", () => {
    for (const source of [BAR, FLOW]) {
      const html = figures.figureHtml(figures.parseFigure(source), "figure-x");
      expect(html).not.toMatch(/\sstyle=/);
      expect(html).not.toMatch(/\s(fill|stroke|color)=/);
      expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    }
  });

  test("text in a figure is escaped", () => {
    const html = figures.figureHtml(
      figures.parseFigure(BAR.replace("title: Paying users who hadn't used it", "title: <b>&</b>")),
      "figure-x",
    );
    expect(html).toContain("&lt;b&gt;&amp;&lt;/b&gt;");
  });

  test("without a max, the scale leaves room after the longest bar", () => {
    const figure = figures.parseFigure(BAR.replace("max: 100\n", ""));
    expect(figures.scaleMax(figure)).toBe(70);
    expect(figures.figureHtml(figure, "f")).not.toContain("chart-track");
  });

  test("a flow is an ordered list of steps, with a step's alternatives under it", () => {
    const figure = figures.parseFigure(FLOW);
    expect(figure.steps!.map((step) => step.name)).toEqual(["Your note", "The Librarian", "Frontmatter"]);
    expect(figure.steps![1]!.options.map((option) => option.name)).toEqual([
      "Your plan",
      "A model on your Mac",
    ]);
    const html = figures.figureHtml(figure, "figure-y");
    expect(html).toContain('<ol class="flow" aria-labelledby="figure-y-title">');
    expect(html).toContain('<ul class="flow-options" aria-label="Either of these">');
  });

  test("the Markdown twin gets a table and a caption, never the fence", () => {
    const twin = figures.figuresToMarkdown(`Before.\n\n\`\`\`figure\n${BAR}\n\`\`\`\n\nAfter.`);
    expect(twin).not.toContain("```");
    expect(twin).toContain("**Figure: Paying users who hadn't used it**");
    expect(twin).toContain(
      "| Tool | Unused for 30 days |\n| --- | --- |\n| ChatGPT | 50.4% |\n| Claude | 27.2% |",
    );
    expect(twin).toContain("*A survey of people. Source: [A report](https://example.com/report).*");
    expect(twin.startsWith("Before.")).toBe(true);
    expect(twin.endsWith("After.")).toBe(true);
    expect(figures.figuresToMarkdown(`\`\`\`figure\n${FLOW}\n\`\`\``)).toContain(
      "2. **The Librarian**: Files it. Either: Your plan (Claude Code or Codex), or A model on your Mac (No network).",
    );
  });

  test("a reading time counts the prose, not a figure's settings and rows", () => {
    expect(
      figures
        .withoutFigures(`Before.\n\n\`\`\`figure\n${BAR}\n\`\`\`\n\nAfter.`)
        .split(/\s+/)
        .filter(Boolean),
    ).toEqual(["Before.", "After."]);
  });

  test("a spec it can't read fails the build, saying why", () => {
    expect(() => figures.parseFigure("kind: bar\ntitle: x")).toThrow(/---/);
    expect(() => figures.parseFigure(BAR.replace("kind: bar", "kind: pie"))).toThrow(/bar or flow/);
    expect(() => figures.parseFigure(BAR.replace("ChatGPT | 50.4", "ChatGPT | about half"))).toThrow(
      /not a number/,
    );
    expect(() => figures.parseFigure(BAR.replace("caption: A survey of people.\n", ""))).toThrow(/caption/);
    expect(() => figures.parseFigure(BAR.replace("max: 100", "max: 40"))).toThrow(/above max/);
    expect(() => figures.parseFigure(BAR.replace("https://example.com/report", "http://x"))).toThrow(/https/);
    expect(() => figures.parseFigure(FLOW.replace("kind: flow", "kind: flow\nunit: %"))).toThrow(
      /not a flow setting/,
    );
    expect(() =>
      figures.parseFigure("kind: flow\ntitle: t\ncaption: c\n---\n- Orphan | option\nA | b"),
    ).toThrow(/step above/);
  });

  test("ids are unique on a page", () => {
    const taken = new Set<string>();
    expect(figures.figureId("Paying users!", taken)).toBe("figure-paying-users");
    expect(figures.figureId("Paying users!", taken)).toBe("figure-paying-users-2");
  });

  test("the Markdown plugin turns only figure fences into HTML, with ids unique per document", () => {
    const replaced: string[] = [];
    const ctx = { replaceNode: (_: unknown, content: { rawHtml: string }) => replaced.push(content.rawHtml) };
    const plugin = figures.figurePlugin();
    plugin.code({ lang: "figure", value: BAR }, ctx);
    plugin.code({ lang: "sh", value: "echo hi" }, ctx);
    plugin.code({ lang: "figure", value: BAR }, ctx);
    expect(replaced).toHaveLength(2);
    expect(replaced[0]).toContain('id="figure-paying-users-who-hadn-t-used-it"');
    expect(replaced[1]).toContain('id="figure-paying-users-who-hadn-t-used-it-2"');
    const fresh: string[] = [];
    figures
      .figurePlugin()
      .code({ lang: "figure", value: BAR }, { replaceNode: (_, c) => fresh.push(c.rawHtml) });
    expect(fresh[0]).toContain('id="figure-paying-users-who-hadn-t-used-it"');
  });

  test("every figure in the published posts parses, and copies the post's own numbers", () => {
    const post = readFileSync(
      siteSrc("content", "writing", "posts", "the-ai-you-already-pay-for.md"),
      "utf8",
    );
    const fences = [...post.matchAll(/```figure\n([\s\S]*?)\n```/g)].map((match) =>
      figures.parseFigure(match[1]!),
    );
    expect(fences.map((figure) => figure.kind)).toEqual(["bar", "bar", "bar", "flow"]);
    const prose = post.replace(/```figure[\s\S]*?```/g, "");
    for (const figure of fences.filter((each) => each.kind === "bar")) {
      for (const row of figure.rows!) expect(prose).toContain(`${row.value}%`);
    }
  });
});

describe("the blog index", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const post = (slug: string, iso: string, featured = false, tags: string[] = []): Post => ({
    slug,
    date: day(iso),
    featured,
    tags,
  });

  test("a post is new for fourteen days from its date", () => {
    expect(blog.NEW_FOR_DAYS).toBe(14);
    expect(blog.isNew(day("2026-10-05"), day("2026-10-06"))).toBe(true);
    expect(blog.isNew(day("2026-09-23"), day("2026-10-06"))).toBe(true);
    expect(blog.isNew(day("2026-09-22"), day("2026-10-06"))).toBe(false);
    expect(blog.isNew(day("2026-10-09"), day("2026-10-06"))).toBe(true);
  });

  test("the newest post leads unless another is marked featured; the list keeps every post", () => {
    const posts = [post("a", "2026-09-01"), post("c", "2026-10-05"), post("b", "2026-10-02")];
    const plain = blog.arrangeBlog(posts);
    expect(plain.featured?.slug).toBe("c");
    expect(plain.secondary.map((each) => each.slug)).toEqual(["b", "a"]);
    expect(plain.all.map((each) => each.slug)).toEqual(["c", "b", "a"]);

    const marked = blog.arrangeBlog([...posts.slice(0, 2), post("b", "2026-10-02", true)]);
    expect(marked.featured?.slug).toBe("b");
    expect(marked.secondary.map((each) => each.slug)).toEqual(["c", "a"]);
  });

  test("the row under the feature holds at most four", () => {
    const many = ["01", "02", "03", "04", "05", "06"].map((d) => post(d, `2026-09-${d}`));
    expect(blog.arrangeBlog(many).secondary).toHaveLength(4);
    expect(blog.arrangeBlog([]).featured).toBeUndefined();
  });

  test("a guide never leads on its date alone: the newest other post does, unless one is marked", () => {
    const guide = { date: day("2026-10-09"), featured: false, guide: true };
    const older: { date: Date; featured: boolean; guide?: boolean } = {
      date: day("2026-10-01"),
      featured: false,
    };
    expect(blog.GUIDE).toBe("Guide");
    expect(blog.arrangeBlog([guide, older]).featured).toBe(older);
    // Posts only up top (the owner, 2026-10-06): a guide never fills the row under the story.
    expect(blog.arrangeBlog([guide, older]).secondary).toEqual([]);
    expect(blog.arrangeBlog([guide, older]).all).toContain(guide);
    expect(blog.arrangeBlog([{ ...guide, featured: true }, older]).featured!.guide).toBe(true);
    expect(blog.arrangeBlog([guide]).featured).toBe(guide);
  });

  test("topics come in the order they appear, once each, with a stable key", () => {
    expect(blog.topicsOf([{ tags: ["AI", "Research"] }, { tags: ["Rotli Web", "AI"] }])).toEqual([
      "AI",
      "Research",
      "Rotli Web",
    ]);
    expect(blog.topicKey("Rotli Web")).toBe("rotli-web");
  });

  test("the article's tree hangs each ### under the ## before it", () => {
    const tree = blog.tocTree([
      { slug: "lead", text: "Lead", depth: 3 },
      { slug: "a", text: "A", depth: 2 },
      { slug: "a1", text: "A1", depth: 3 },
      { slug: "deep", text: "Deep", depth: 4 },
      { slug: "a2", text: "A2", depth: 3 },
      { slug: "b", text: "B", depth: 2 },
    ]);
    expect(tree).toEqual([
      { slug: "lead", text: "Lead", children: [] },
      {
        slug: "a",
        text: "A",
        children: [
          { slug: "a1", text: "A1" },
          { slug: "a2", text: "A2" },
        ],
      },
      { slug: "b", text: "B", children: [] },
    ]);
  });
});

describe("the rail's short title", () => {
  test("is the first sentence of a title with more than one, else the whole title", () => {
    expect(blog.railTitle("Paid AI plans often sit unopened. rotli can put them to work.")).toBe(
      "Paid AI plans often sit unopened.",
    );
    expect(blog.railTitle("Why Rotli Web talks to your computer through Terminal")).toBe(
      "Why Rotli Web talks to your computer through Terminal",
    );
    expect(blog.railTitle("Ends with a stop.")).toBe("Ends with a stop.");
  });
});

// The rail's Sources (site/src/sources.ts) are read from the post's own `## Sources` list, so the
// citations have one home. Held against the published post itself: change a citation there and
// this list is what the rail will show.
describe("a post's sources", () => {
  const post = (slug: string) => readFileSync(siteSrc("content", "writing", "posts", `${slug}.md`), "utf8");

  test("the unused-plans post: every citation, numbered, publisher and short title, linked", () => {
    expect(sources.sourcesOf(post("the-ai-you-already-pay-for"))).toEqual([
      {
        number: 1,
        publisher: "Self Financial",
        title: "The Cost of Unused Paid Subscriptions 2026",
        url: "https://www.self.inc/info/cost-of-unused-paid-subscriptions/",
      },
      {
        number: 2,
        publisher: "Menlo Ventures",
        title: "2026: The State of Consumer AI",
        url: "https://menlovc.com/perspective/2026-the-state-of-consumer-ai/",
      },
      {
        // Two links in the citation: the first is the source; a long title keeps its main part.
        number: 3,
        publisher: "Bango",
        title: "It’s not a bubble",
        url: "https://bango.com/its-not-a-bubble-over-three-quarters-say-their-ai-subscriptions-are-now-essential-to-everyday-life/",
      },
      {
        // An author list shortens.
        number: 4,
        publisher: "Chatterji et al.",
        title: "How People Use ChatGPT",
        url: "https://www.nber.org/papers/w34255",
      },
      {
        number: 5,
        publisher: "Anthropic",
        title: "Economic Index report: Cadences",
        url: "https://www.anthropic.com/research/economic-index-june-2026-report",
      },
      {
        number: 6,
        publisher: "JetBrains Research",
        title: "Which AI coding tools do developers actually use at work?",
        url: "https://blog.jetbrains.com/research/2026/04/which-ai-coding-tools-do-developers-actually-use-at-work/",
      },
      {
        number: 7,
        publisher: "Anthropic",
        title: "Use Claude Code with your Pro or Max plan",
        url: "https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan",
      },
      {
        // Link text without quotation marks is taken as written.
        number: 8,
        publisher: "OpenAI",
        title: "ChatGPT plans and Codex usage",
        url: "https://learn.chatgpt.com/docs/pricing",
      },
      {
        number: 9,
        publisher: "Stark Insider",
        title: "Anthropic adds weekly limits to Claude, cites abuses",
        url: "https://www.starkinsider.com/2025/07/anthropic-adds-weekly-limits-to-claude-cites-abuses.html",
      },
    ]);
  });

  test("a post without a Sources section has none, so the rail renders no block", () => {
    expect(sources.sourcesOf(post("rotli-web-and-your-mac"))).toEqual([]);
    expect(sources.sourcesOf("## Intro\n\nText.\n\n- [a](https://a.example/)\n")).toEqual([]);
  });

  test("the section ends at the next heading; bullets count; an item without a link is plain", () => {
    const markdown = [
      "Body with [a link](https://body.example/).",
      "## Sources",
      "",
      "- Ministry, a report with no address, 2025.",
      "- Lab, [*Findings*](https://lab.example/findings), with notes",
      "  that run on to a second line.",
      "",
      "## Afterword",
      "",
      "1. Not a source, [x](https://x.example/).",
    ].join("\n");
    expect(sources.sourcesOf(markdown)).toEqual([
      { number: 1, publisher: "Ministry", title: "a report with no address, 2025." },
      { number: 2, publisher: "Lab", title: "Findings", url: "https://lab.example/findings" },
    ]);
  });
});

describe("more posts beside a post", () => {
  const published = ["a", "b", "c", "d", "e"];
  test("the newest other published posts, never the post itself", () => {
    expect(blog.MORE_POSTS).toBe(3);
    expect(blog.morePosts("b", published, ["soon"])).toEqual([
      { item: "a", soon: false },
      { item: "c", soon: false },
      { item: "d", soon: false },
    ]);
  });
  test("announced posts fill in only when there are too few published ones", () => {
    expect(blog.morePosts("a", ["a", "b"], ["s1", "s2", "s3"])).toEqual([
      { item: "b", soon: false },
      { item: "s1", soon: true },
      { item: "s2", soon: true },
    ]);
    expect(blog.morePosts("a", ["a"], [])).toEqual([]);
  });
});

// rotli's own spots (site/src/promos.ts): house promotions only, every one a first-party or
// rotli-owned link with local art, so a post loads nothing from anyone else.
describe("the From rotli spots", () => {
  test("each entry is complete, labelled as rotli's, and pictured with the site's own art", () => {
    const ids = new Set<string>();
    for (const promo of promos.PROMOS) {
      expect(ids.has(promo.id)).toBe(false);
      ids.add(promo.id);
      expect(promo.label).toBe(promos.PROMO_LABEL);
      expect(promos.PROMO_LABEL).toBe("From rotli");
      expect(promo.title.length).toBeGreaterThan(3);
      expect(promo.text.length).toBeGreaterThan(10);
      expect(promo.text.length).toBeLessThanOrEqual(90);
      expect(Object.keys(poses)).toContain(promo.pose);
      // On this site, or (marked external) on rotli's own studio; never anyone else's.
      if (promo.external) expect(new URL(promo.href).hostname).toMatch(/(^|\.)rotli\.co$/);
      else expect(promo.href).toMatch(/^[/#]/);
      expect(JSON.stringify(promo)).not.toMatch(/sponsor/i);
    }
    expect([...ids]).toEqual(expect.arrayContaining(["download", "roadmap", "newsletter", "web", "studio"]));
    const studio = promos.PROMOS.find((promo) => promo.id === "studio")!;
    expect(studio.href).toBe("https://studio.rotli.co/");
    expect(studio.external).toBe(true);
  });

  test("a build offers only what it has: no Download without downloads, no Rotli Web without it", () => {
    const ids = (offers: { downloads: boolean; webApp: boolean }) =>
      promos.availablePromos(promos.PROMOS, offers).map((promo) => promo.id);
    expect(ids({ downloads: false, webApp: false })).not.toContain("download");
    expect(ids({ downloads: false, webApp: false })).not.toContain("web");
    expect(ids({ downloads: true, webApp: true })).toEqual(promos.PROMOS.map((promo) => promo.id));
  });

  test("posts rotate through the spots, two at a time, so every spot is shown across the blog", () => {
    const list = promos.PROMOS;
    expect(promos.RAIL_PROMOS).toBe(2);
    expect(promos.promosFor(0, 2, list).map((p) => p.id)).toEqual([list[0]!.id, list[1]!.id]);
    expect(promos.promosFor(1, 2, list).map((p) => p.id)).toEqual([list[2]!.id, list[3]!.id]);
    const shown = new Set<string>();
    for (let index = 0; index < Math.ceil(list.length / 2); index++) {
      for (const promo of promos.promosFor(index, 2, list)) shown.add(promo.id);
    }
    expect(shown.size).toBe(list.length);
    expect(promos.promosFor(3, 2, [])).toEqual([]);
    expect(promos.promosFor(0, 2, [list[0]!])).toHaveLength(1);
  });
});
