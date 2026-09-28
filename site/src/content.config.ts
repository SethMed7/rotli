// Writing on the site: evergreen resources (question-titled articles) and dated
// blog posts, all plain Markdown under src/content/writing/. Which entries a
// deployment publishes is src/writing.ts.
import { readFile } from 'node:fs/promises';

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

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
  }),
});

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
      const body = start >= 0 ? raw.slice(start + 1) : raw;
      store.clear();
      store.set({ id: 'changelog', data: {}, body, rendered: await renderMarkdown(body) });
    },
  },
});

export const collections = { writing, changelog };
