// Writing on the site: evergreen resources (question-titled articles) and dated
// blog posts, all plain Markdown under src/content/writing/. Which entries a
// deployment publishes is src/writing.ts.
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

export const collections = { writing };
