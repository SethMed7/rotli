// Which writing a deployment publishes. The coming-soon build publishes none;
// drafts and experiments appear only on the dev site (site.showsExperiments).
// An entry with `status: coming-soon` is announced on its index but has no page.
import { getCollection, type CollectionEntry } from 'astro:content';
import { site } from './site';

export type Writing = CollectionEntry<'writing'>;

/** The URL slug: the file name without its section folder. */
export function slugOf(entry: Writing): string {
  return entry.id.split('/').pop() ?? entry.id;
}

/** Entries this build may show at all: none in coming-soon mode; drafts and
 * experiments on the dev site only. */
async function visibleWriting(section: Writing['data']['section']): Promise<Writing[]> {
  if (!site.showsFullSite) return [];
  const entries = await getCollection(
    'writing',
    (entry) =>
      entry.data.section === section &&
      (site.showsExperiments || (!entry.data.draft && !entry.data.experiment)),
  );
  return entries.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** Readable writing, newest first: each gets a page, a Markdown twin, a
 * sitemap entry, and an llms.txt line. */
export async function publishedWriting(section: Writing['data']['section']): Promise<Writing[]> {
  return (await visibleWriting(section)).filter((entry) => entry.data.status === 'published');
}

/** Announced writing (`status: coming-soon`): listed on its index with a
 * label, never linked, and never a page. */
export async function upcomingWriting(section: Writing['data']['section']): Promise<Writing[]> {
  return (await visibleWriting(section)).filter((entry) => entry.data.status === 'coming-soon');
}

/** About how long a piece takes to read, at 230 words a minute. */
export function readingMinutes(entry: Writing): number {
  const words = (entry.body ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}
