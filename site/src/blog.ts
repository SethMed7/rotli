// How /blog/ arranges its posts (pages/blog/[...slug].astro), without Astro: one featured
// story, a short secondary row, the full dated list, and which posts are new. Pure, so the rules
// are unit-tested (scripts/site-writing.test.ts) and the page only renders what this returns.

export interface Dated {
  date: Date;
  /** The frontmatter flag that leads the page instead of the newest post. */
  featured: boolean;
  /** A guide (tagged GUIDE): evergreen, so it never leads the page on its date alone. */
  guide?: boolean;
}

/** The tag that marks a guide: the evergreen how-to posts, which were /resources/ until 2026-10-06. */
export const GUIDE = 'Guide';

/** How long a post wears "New": computed when the site is built, so it ages out by rebuilding. */
export const NEW_FOR_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** Published within the last `days` days of `now` (a post dated in the future counts as new). */
export function isNew(date: Date, now: Date, days = NEW_FOR_DAYS): boolean {
  return now.getTime() - date.getTime() < days * DAY;
}

/** How many posts sit in the row under the featured story. */
export const SECONDARY = 3;

export interface Arranged<T> {
  featured: T | undefined;
  secondary: T[];
  /** Every published post, newest first: the archive, which the topic filter narrows. */
  all: T[];
}

/**
 * The featured story is the newest post marked `featured`, or else the newest post that is not a
 * guide (a guide leads only when marked, or when there is nothing else); the next posts (newest
 * first, up to SECONDARY, guides included) form the row under it. The list holds every post, the
 * featured ones included, so filtering by a topic never hides a post that matches it.
 */
export function arrangeBlog<T extends Dated>(posts: readonly T[]): Arranged<T> {
  const all = [...posts].sort((a, b) => b.date.getTime() - a.date.getTime());
  const featured = all.find((post) => post.featured) ?? all.find((post) => !post.guide) ?? all[0];
  const secondary = all.filter((post) => post !== featured).slice(0, SECONDARY);
  return { featured, secondary, all };
}

/** The topics on the list's filter, in the order they first appear down the list. */
export function topicsOf(posts: readonly { tags: readonly string[] }[]): string[] {
  return [...new Set(posts.flatMap((post) => post.tags))];
}

/** A topic as a token for `data-topics` and the filter buttons ("Rotli Web" → "rotli-web"). */
export function topicKey(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A heading the article's tree lists: a `##` (depth 2) or a `###` under it (depth 3). */
export interface TocItem {
  slug: string;
  text: string;
  depth: number;
}

export interface TocBranch {
  slug: string;
  text: string;
  children: { slug: string; text: string }[];
}

/**
 * The "On this page" tree: each `##` with the `###` headings that follow it as its branches.
 * Deeper headings are left out, and a `###` before any `##` stands on its own.
 */
export function tocTree(items: readonly TocItem[]): TocBranch[] {
  const tree: TocBranch[] = [];
  for (const item of items) {
    const parent = tree.at(-1);
    if (item.depth === 3 && parent) parent.children.push({ slug: item.slug, text: item.text });
    else if (item.depth === 2 || item.depth === 3) tree.push({ slug: item.slug, text: item.text, children: [] });
  }
  return tree;
}

/**
 * The post's title for its rail: the first sentence when the title has more than one ("Paid AI
 * plans often sit unopened." of "Paid AI plans often sit unopened. rotli can put them to work."),
 * else the whole title. The page's h1 always carries the whole title.
 */
export function railTitle(title: string): string {
  const match = title.match(/^(.+?[.!?])\s+\S/);
  return match ? match[1]! : title;
}

/** How many other posts a post suggests (its right rail, or "More from rotli" under it). */
export const MORE_POSTS = 3;

/**
 * The other posts a post suggests: the newest published ones that are not this one, and only when
 * there are fewer than `count` of those, announced (coming-soon) posts to fill the rest, marked
 * `soon` so the page labels them and never links them.
 */
export function morePosts<T>(
  current: T,
  published: readonly T[],
  upcoming: readonly T[],
  count = MORE_POSTS,
): { item: T; soon: boolean }[] {
  const others = published.filter((post) => post !== current).map((item) => ({ item, soon: false }));
  const fill = upcoming.slice(0, Math.max(0, count - others.length)).map((item) => ({ item, soon: true }));
  return [...others, ...fill].slice(0, count);
}
