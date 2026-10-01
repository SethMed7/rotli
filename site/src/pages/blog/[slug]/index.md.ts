// /blog/<slug>/index.md: the page's Markdown twin, straight from its source
// (src/agents.ts). A request for the page with `Accept: text/markdown` is
// answered with it (site/Caddyfile), and the page declares it as an alternate.
import type { APIRoute, GetStaticPaths } from 'astro';

import { writingMarkdown } from '../../../agents';
import { publishedWriting, slugOf, type Writing } from '../../../writing';

export const getStaticPaths = (async () =>
  (await publishedWriting('post')).map((entry) => ({
    params: { slug: slugOf(entry) },
    props: { entry },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(writingMarkdown((props as { entry: Writing }).entry), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
