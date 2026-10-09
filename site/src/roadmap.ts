// ROADMAP.md (repository root) read as data: the one source for the /roadmap/
// page, its Markdown twin, and the ids the site's sidecar accepts votes for
// (site/server/roadmap.ts). Pure text in, data out: no file system, no Astro,
// so the page build, the sidecar, and the tests all parse the same way.
//
// The file's convention (documented at its top): every list item under a
// numbered `## N. Section` heading reads
//
//   - **Title** <!-- id: some-id --> · Size — summary sentence. More detail…
//
// The size is optional. The id is the stable key votes attach to. A missing,
// malformed, or repeated id throws, so the site build fails instead of
// publishing an item nobody can vote for (or two items sharing one count).

/** The sections the website shows, in page order. Everything else stays in the file. */
export const PUBLIC_SECTIONS = ["In the work", "Planned", "Ideas"] as const;
export type PublicSectionTitle = (typeof PUBLIC_SECTIONS)[number];

/** The file's own size legend, said once for the page. */
export const SIZES: { size: string; meaning: string }[] = [
  { size: "S", meaning: "hours" },
  { size: "M", meaning: "days" },
  { size: "L", meaning: "1–3 weeks" },
  { size: "XL", meaning: "a month or more" },
];

/** A feature request's limits: the page's form says them, the sidecar enforces them. */
export const REQUEST_LIMITS = {
  title: { min: 3, max: 120 },
  description: { min: 10, max: 2000 },
} as const;

export interface RoadmapItem {
  id: string;
  /** Plain text; backticks mark code (`/chart`). */
  title: string;
  /** "M", "M–L", … or null when the file gives none. */
  size: string | null;
  /** The first sentence after the dash, links reduced to their words. */
  summary: string;
}

export interface RoadmapSection {
  title: string;
  /** A URL fragment for the section: "in-the-work". */
  slug: string;
  items: RoadmapItem[];
}

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECTION = /^## \d+\.\s+(.+?)\s*$/;
const HEAD =
  /^- \*\*(.+?)\*\*(?:\s*<!--\s*id:\s*(\S+?)\s*-->)?\s*(?:·\s*([^—]+?)\s*)?—\s*([\s\S]*)$/;

export class RoadmapError extends Error {
  override name = "RoadmapError";
}

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Links read as their words; a parenthesized link to a repo document is dropped. */
function plain(text: string): string {
  return text
    .replace(/\s*\(\[[^\]]+\]\([^)\s]+\)\)/g, "")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence: up to the first stop followed by a new sentence, or the end. */
export function firstSentence(text: string): string {
  const flat = plain(text);
  const stop = flat.search(/[.!?](?=\s+[A-Z("`]|\s*$)/);
  const sentence = stop >= 0 ? flat.slice(0, stop + 1) : flat;
  return sentence.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

/** Every numbered section and its items, in file order. Throws RoadmapError on a bad id. */
export function parseRoadmap(markdown: string): RoadmapSection[] {
  const sections: RoadmapSection[] = [];
  const seen = new Map<string, string>();
  let section: RoadmapSection | null = null;
  /** The item being read: its head paragraph so far, and whether the paragraph has ended. */
  let item: { lines: string[]; closed: boolean } | null = null;
  let fenced = false;

  const finish = () => {
    if (!item || !section) return;
    const head = item.lines.join(" ");
    item = null;
    const match = HEAD.exec(head);
    if (!match) {
      throw new RoadmapError(
        `ROADMAP.md: an item in "${section.title}" does not read "- **Title** <!-- id: … --> · Size — summary": ${head.slice(0, 80)}`,
      );
    }
    const [, rawTitle, id, size, rest] = match;
    const title = plain(rawTitle);
    if (!id) throw new RoadmapError(`ROADMAP.md: "${title}" in "${section.title}" has no id (<!-- id: … -->).`);
    if (!ID_PATTERN.test(id)) {
      throw new RoadmapError(`ROADMAP.md: "${title}" has the id "${id}"; ids are lowercase words joined by hyphens.`);
    }
    const other = seen.get(id);
    if (other !== undefined) {
      throw new RoadmapError(`ROADMAP.md: the id "${id}" is used twice ("${other}" and "${title}").`);
    }
    seen.set(id, title);
    section.items.push({ id, title, size: size?.trim() || null, summary: firstSentence(rest) });
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      if (item) item.closed = true;
      continue;
    }
    if (fenced) continue;
    const heading = SECTION.exec(line);
    if (heading) {
      finish();
      section = { title: heading[1], slug: slugify(heading[1]), items: [] };
      sections.push(section);
      continue;
    }
    if (/^#/.test(line)) {
      // A heading outside the numbered sections (the file's title) ends the last one.
      finish();
      section = null;
      continue;
    }
    if (!section) continue;
    if (line.startsWith("- ")) {
      finish();
      item = { lines: [line.trim()], closed: false };
      continue;
    }
    if (!item) continue;
    if (line.trim() === "" || /^\s+[-*] /.test(line)) {
      item.closed = true;
    } else if (/^\s/.test(line)) {
      if (!item.closed) item.lines.push(line.trim());
    } else {
      // An unindented paragraph after the list ends the item.
      finish();
    }
  }
  finish();
  return sections;
}

/** The three sections the page shows, in page order; throws if the file lost one. */
export function publicRoadmap(markdown: string): RoadmapSection[] {
  const sections = parseRoadmap(markdown);
  return PUBLIC_SECTIONS.map((title) => {
    const found = sections.find((section) => section.title === title);
    if (!found) throw new RoadmapError(`ROADMAP.md has no "## N. ${title}" section.`);
    return found;
  });
}

/** Whether /roadmap/ offers votes. Off for now (the owner, 2026-10-09: "for now lets remove it
 * and say it is in the works"): no vote buttons or "Most votes", and every invitation to vote
 * (the page, the menu, the promo, the Features banner, the agent files) says voting is coming.
 * The sidecar's vote endpoints stay; turning this on brings it all back. */
export const VOTING_OPEN = false;

/** The ids people may vote for: every item on the page. */
export function votableIds(markdown: string): string[] {
  return publicRoadmap(markdown).flatMap((section) => section.items.map((item) => item.id));
}

/** A title or summary split for rendering: odd parts were inside backticks. */
export function codeParts(text: string): { code: boolean; text: string }[] {
  return text
    .split("`")
    .map((part, index) => ({ code: index % 2 === 1, text: part }))
    .filter((part) => part.text !== "");
}
