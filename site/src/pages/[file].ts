// /llms-full.txt: the whole site in one Markdown file for AI systems (src/agents.ts
// `llmsFullText`), the long companion to /llms.txt. Emitted only where the full site is
// (a dynamic route, so the holding page's build skips it).
import type { APIRoute, GetStaticPaths } from 'astro';

import { llmsFullText } from '../agents';
import { publicRoadmap } from '../roadmap';
import { readRoadmapFile } from '../roadmap-file';
import { site } from '../site';
import { publishedWriting } from '../writing';

export const getStaticPaths = (() => (site.showsFullSite ? [{ params: { file: 'llms-full.txt' } }] : [])) satisfies GetStaticPaths;

export const GET: APIRoute = async () =>
  new Response(
    llmsFullText({ posts: await publishedWriting('post'), roadmap: publicRoadmap(readRoadmapFile()) }),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } },
  );
