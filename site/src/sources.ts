// A post's sources for its left rail (blog/ArticleRail.astro), read at build time from the post's
// own `## Sources` section, so the citations have one home: the Markdown. The section is a list
// (numbered or bulleted); each item is one source, written as
//
//   1. Publisher, [“Title”](https://…), whatever else the citation says.
//
// and may run on over indented lines. The rail shows the publisher and a short title, linked to
// the first URL in the item; the article keeps the full citation. Pure, so it is unit-tested
// (scripts/site-writing.test.ts) against the published posts' own text.

export interface Source {
  /** 1-based, the same number the article's list shows. */
  number: number;
  /** Who published it ("Self Financial"); an author list shortens to "First et al.". */
  publisher: string;
  /** The linked title, without its quotation marks; a long one is cut at its subtitle's colon. */
  title: string;
  /** The first link in the citation; undefined when the item has none. */
  url?: string;
}

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
const ITEM = /^(?:\d+[.)]|[-*+])\s+(.*)$/;

/** The `## Sources` section's list items as plain lines, continuation lines joined on. */
function sourceItems(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Sources\s*#*\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  let fenced = false;
  for (const raw of lines.slice(start + 1)) {
    if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced;
    if (fenced) continue;
    // The section ends at the next heading of the same or a higher level.
    if (/^#{1,2}\s/.test(raw)) break;
    const item = raw.match(ITEM);
    if (item) items.push(item[1]!.trim());
    else if (raw.trim() !== '' && /^\s/.test(raw) && items.length > 0) items[items.length - 1] += ` ${raw.trim()}`;
  }
  return items;
}

const unquote = (text: string) =>
  text
    .trim()
    .replace(/^[“"‘']+|[”"’']+$/g, '')
    .trim();

/** Longer than this, a title with a subtitle keeps only its main title. */
const SHORT_TITLE = 48;

/** "Main title: a long subtitle" → "Main title", when the whole is long and the main title is at
 * least two words ("2026: The State of Consumer AI" stays whole). */
function shortTitle(title: string): string {
  const colon = title.indexOf(': ');
  if (colon < 0 || title.length <= SHORT_TITLE) return title;
  const head = title.slice(0, colon).trim();
  return head.split(/\s+/).length >= 2 ? head : title;
}

/** "A, B, C and D" (an author list) → "A et al."; a publisher name stays as written. */
function shortPublisher(lead: string): string {
  const parts = lead.split(/,\s*/).filter(Boolean);
  return parts.length > 2 ? `${parts[0]} et al.` : lead;
}

/** Plain text of a bit of inline Markdown (emphasis and code marks dropped). */
const plain = (text: string) => text.replace(/[*_`]/g, '').trim();

/** Every source in the post's `## Sources` list, in order; empty when there is no such section. */
export function sourcesOf(markdown: string): Source[] {
  return sourceItems(markdown).map((item, index) => {
    const link = item.match(LINK);
    if (!link || link.index === undefined) {
      const [lead = item, ...rest] = item.split(/,\s*/);
      return { number: index + 1, publisher: plain(lead), title: plain(rest.join(', ')) };
    }
    const lead = plain(item.slice(0, link.index).replace(/[\s,;:–—-]+$/, ''));
    return {
      number: index + 1,
      publisher: shortPublisher(lead),
      title: shortTitle(unquote(plain(link[1]!))),
      url: link[2]!,
    };
  });
}
