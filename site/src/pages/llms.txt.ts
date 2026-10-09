// /llms.txt: the site summarized for AI systems (src/agents.ts).
import type { APIRoute } from 'astro';

import { llmsText } from '../agents';
import { publishedWriting } from '../writing';

export const GET: APIRoute = async () =>
  new Response(llmsText({ resources: await publishedWriting('resource'), posts: await publishedWriting('post') }), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
