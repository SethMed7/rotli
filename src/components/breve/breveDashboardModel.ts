export interface BreveDashboardStory {
  title: string;
  summary: string;
}

export interface BreveDashboardResource {
  label: string;
  url: string;
}

export interface BreveDashboardDigest {
  headline: string;
  actions: string[];
  stories: BreveDashboardStory[];
  resources: BreveDashboardResource[];
}

const NON_NEWS_SECTIONS = new Set(["headline", "action items", "worth your time", "resources"]);

function plain(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/^[-+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? markdown.slice(match[0].length) : markdown;
}

/** Reduce a durable Breve issue into a compact dashboard projection. Nothing
 * here becomes a second news store: the latest Markdown brief remains truth. */
export function briefDashboardDigest(markdown: string): BreveDashboardDigest {
  const body = withoutFrontmatter(markdown);
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const raw of body.split(/\r?\n/)) {
    const heading = raw.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { title: plain(heading[1] ?? ""), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(raw);
    }
  }

  const section = (name: string) => sections.find((entry) => entry.title.toLowerCase() === name)?.lines ?? [];
  const headline = plain(section("headline").filter(Boolean).join(" "));
  const actions = section("action items")
    .filter((line) => /^\s*[-+]\s+/.test(line))
    .map(plain)
    .filter(Boolean)
    .slice(0, 4);
  const stories = sections
    .filter((entry) => !NON_NEWS_SECTIONS.has(entry.title.toLowerCase()))
    .map((entry) => ({
      title: entry.title,
      summary: plain(entry.lines.filter(Boolean).join(" ")),
    }))
    .filter((entry) => entry.title && entry.summary)
    .slice(0, 5);

  const resources: BreveDashboardResource[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = match[2] ?? "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    resources.push({ label: plain(match[1] ?? url), url });
    if (resources.length === 6) break;
  }

  return { headline, actions, stories, resources };
}
