import type { APIRoute } from 'astro';
import { site } from '../site';

const body = site.indexable
  ? `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap-index.xml\n`
  : 'User-agent: *\nDisallow: /\n';

export const GET: APIRoute = () =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
