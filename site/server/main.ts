// The site's sidecar: one small Bun process on 127.0.0.1 behind Caddy (site/Caddyfile
// `handle /api/*`), started by site/entrypoint.sh. It answers two things the static
// pages cannot:
//
//   /api/subscribe   the "hear when it's ready" list (subscribe.ts → a Resend segment)
//   /api/roadmap/*   votes and feature requests for /roadmap/ (roadmap.ts → SQLite)
//
// Each half is off on its own when its variables are unset, and the pages read that as
// "not open yet". Runtime variables only (never Docker build args):
//   RESEND_API_KEY, RESEND_SEGMENT_ID   the list
//   SUBSCRIBE_ALERT_TO, SUBSCRIBE_ALERT_FROM   optional; email the owner each new signup
//   ROADMAP_DB_PATH                     the SQLite file, on a Railway volume
//   ROADMAP_HASH_SALT                   optional; keys the in-memory rate limits
//   ROADMAP_FILE                        optional; where ROADMAP.md is (default: the repo root)
//   SUBSCRIBE_PORT                      the loopback port Caddy proxies to (default 8787)
import { readFileSync } from 'node:fs';

import { votableIds } from '../src/roadmap';
import { createRoadmap } from './roadmap';
import { createSubscribe, normalizeEmail } from './subscribe';

type Handler = (req: Request) => Promise<Response>;

/** Route by path: the list, the roadmap, and nothing else. */
export function createSidecar(routes: { subscribe: Handler; roadmap: Handler }): Handler {
  return async (req) => {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/subscribe') return routes.subscribe(req);
    if (pathname.startsWith('/api/roadmap/')) return routes.roadmap(req);
    return new Response('Not found', { status: 404 });
  };
}

/** The ids on the page, read from ROADMAP.md once at start; none (participation off) if unreadable. */
export function readVotableIds(path: string | URL, log: (line: string) => void = console.warn): string[] {
  try {
    return votableIds(readFileSync(path, 'utf8'));
  } catch (error) {
    log(`roadmap: ROADMAP.md could not be read (${error instanceof Error ? error.message : 'error'}); voting is off`);
    return [];
  }
}

const env = process.env;
const ids = readVotableIds(env.ROADMAP_FILE || new URL('../../ROADMAP.md', import.meta.url));
const roadmap = createRoadmap({ dbPath: env.ROADMAP_DB_PATH, ids, salt: env.ROADMAP_HASH_SALT });
const port = Number(env.SUBSCRIBE_PORT ?? 8787);

if ((import.meta as { main?: boolean }).main) {
  const list = env.RESEND_API_KEY && env.RESEND_SEGMENT_ID ? 'on' : 'off (RESEND_API_KEY or RESEND_SEGMENT_ID unset)';
  // The same test createSubscribe applies, so an unusable recipient never reads as "on".
  const alerts = !env.SUBSCRIBE_ALERT_TO || !env.SUBSCRIBE_ALERT_FROM
    ? 'off'
    : normalizeEmail(env.SUBSCRIBE_ALERT_TO)
      ? 'on'
      : 'off (SUBSCRIBE_ALERT_TO is not an email address)';
  const votes = roadmap.live ? `on (${ids.length} items)` : 'off (ROADMAP_DB_PATH unset or unopenable)';
  console.log(`site sidecar on 127.0.0.1:${port} · list ${list} (alerts ${alerts}) · roadmap ${votes}`);
}

export default {
  // Loopback only: Caddy is the one way in.
  hostname: '127.0.0.1',
  // Never Bun's development error page (stack traces) for a visitor.
  development: false,
  // A ceiling under the routes' own byte caps: no post here is more than a few KB.
  maxRequestBodySize: 64 * 1024,
  port,
  fetch: createSidecar({
    subscribe: createSubscribe({
      apiKey: env.RESEND_API_KEY,
      segmentId: env.RESEND_SEGMENT_ID,
      alertTo: env.SUBSCRIBE_ALERT_TO,
      alertFrom: env.SUBSCRIBE_ALERT_FROM,
    }),
    roadmap: roadmap.handle,
  }),
};
