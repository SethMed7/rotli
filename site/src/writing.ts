// Which writing a deployment publishes. The coming-soon build publishes none;
// drafts and experiments appear only on the dev site (site.showsExperiments).
import { getCollection, type CollectionEntry } from 'astro:content';
import { site } from './site';

export type Writing = CollectionEntry<'writing'>;

/** The URL slug: the file name without its section folder. */
export function slugOf(entry: Writing): string {
  return entry.id.split('/').pop() ?? entry.id;
}

export async function publishedWriting(section: Writing['data']['section']): Promise<Writing[]> {
  if (!site.showsFullSite) return [];
  const entries = await getCollection(
    'writing',
    (entry) =>
      entry.data.section === section &&
      (site.showsExperiments || (!entry.data.draft && !entry.data.experiment)),
  );
  return entries.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}
