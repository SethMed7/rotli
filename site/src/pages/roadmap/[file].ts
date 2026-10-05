// /roadmap/index.md: the roadmap page's Markdown twin (src/agents.ts `roadmapMarkdown`),
// built from ROADMAP.md like the page. A request for /roadmap/ with
// `Accept: text/markdown` is answered with it (site/Caddyfile). Emitted only where
// the page is (a dynamic route, so the holding page's build skips it).
import type { APIRoute, GetStaticPaths } from 'astro';

import { roadmapMarkdown } from '../../agents';
import { publicRoadmap } from '../../roadmap';
import { readRoadmapFile } from '../../roadmap-file';
import { site } from '../../site';

export const getStaticPaths = (() => (site.showsFullSite ? [{ params: { file: 'index.md' } }] : [])) satisfies GetStaticPaths;

export const GET: APIRoute = () =>
  new Response(roadmapMarkdown(publicRoadmap(readRoadmapFile())), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
