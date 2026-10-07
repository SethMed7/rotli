// /features/index.md: the catalog's Markdown twin (src/features.ts `catalogMarkdown`), every
// capability with its status, where it runs, and its page. A request for /features/ with
// `Accept: text/markdown` is answered with it (site/Caddyfile). Emitted only where the page
// is (a dynamic route, so the holding page's build skips it).
import type { APIRoute, GetStaticPaths } from 'astro';

import { catalogMarkdown } from '../../features';
import { site } from '../../site';

export const getStaticPaths = (() => (site.showsFullSite ? [{ params: { file: 'index.md' } }] : [])) satisfies GetStaticPaths;

export const GET: APIRoute = () =>
  new Response(catalogMarkdown(site.url), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
