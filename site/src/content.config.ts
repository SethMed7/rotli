// Writing on the site: evergreen resources (question-titled articles) and dated
// blog posts, all plain Markdown under src/content/writing/. Which entries a
// deployment publishes is src/writing.ts.
import { readFile } from 'node:fs/promises';

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { GITHUB_URL, site } from './site';

const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(['resource', 'post']),
    /** Posts show it; resources use it only to order the index. */
    date: z.coerce.date(),
    /** Drafts render on the dev site only. */
    draft: z.boolean().default(false),
    /** Describes a capability under review: dev site only, labeled. */
    experiment: z.boolean().default(false),
    /**
     * `coming-soon`: listed on its index with a "Coming soon" label and no
     * link. It has no page, Markdown twin, sitemap entry, or llms.txt line
     * until it becomes `published` (src/writing.ts).
     */
    status: z.enum(['published', 'coming-soon']).default('published'),
  }),
});

/** A link to a file in the repository (`docs/…`) would 404 on the site: it
 * points at the file on GitHub when the source is public, and is plain text
 * when it is not. */
function repoLinks(markdown: string): string {
  return markdown.replace(
    /\[([^\]]+)\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi,
    (_, text: string, path: string) => (site.sourcePublic ? `[${text}](${GITHUB_URL}/blob/main/${path})` : text),
  );
}

/** The product changelog at the repository root, from its first shipped
 * release heading on (the file's title, preamble, and [Unreleased] work belong
 * to the repo, not the page), rendered by Astro's own Markdown pipeline. One entry. The Dockerfile
 * copies CHANGELOG.md beside site/ so the Railway build can read it. */
const changelog = defineCollection({
  loader: {
    name: 'changelog',
    load: async ({ store, renderMarkdown }) => {
      const raw = await readFile(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
      const start = raw.search(/\n## \[\d/);
      const body = repoLinks(start >= 0 ? raw.slice(start + 1) : raw);
      store.clear();
      store.set({ id: 'changelog', data: {}, body, rendered: await renderMarkdown(body) });
    },
  },
});

export const collections = { writing, changelog };
