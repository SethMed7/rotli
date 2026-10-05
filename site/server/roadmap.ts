// The roadmap's participation (rotli.co/roadmap/): votes per item and feature
// requests, kept in one small SQLite file through Bun's built-in bun:sqlite.
// Served by the site's sidecar behind Caddy (site/server/main.ts).
//
//   GET/HEAD /api/roadmap/votes    → { live: true, votes: { [id]: count } }
//   POST     /api/roadmap/vote     → { ok, count, counted } for { id }
//   POST     /api/roadmap/request  → { ok } for { title, description, email? }; a plain form
//                                    post (no JavaScript) is redirected to /roadmap/#request-sent
//
// Off unless ROADMAP_DB_PATH names a writable file (a Railway volume): then every route
// answers 503 { live: false } and the page says voting and requests open soon.
//
// What is kept, and what is not:
// - votes: one count per item id. No row per vote, no address, no time.
// - requests: the title, the description, an optional email for a follow-up, and the
//   time it came in. Never published by the site: only the owner reads them
//   (site/scripts/roadmap-requests.ts).
// - abuse limits run in memory only, keyed on an HMAC of the visitor's address and the
//   UTC day under a salt that never leaves the process (ROADMAP_HASH_SALT, or a random
//   one per start). The raw address is never stored or logged, and the keys rotate daily.
//   The same key dedupes a vote: one counted vote per item per address per day, on top
//   of the page's own one-per-browser marker in localStorage.
import { Database } from 'bun:sqlite';
import { createHmac, randomBytes } from 'node:crypto';

import { REQUEST_LIMITS } from '../src/roadmap';
import { clientAddress, limiter, NO_STORE, page, readFields, wantsJson } from './http';
import { normalizeEmail } from './subscribe';

/** The hidden field only bots fill in (the page's request form). */
export const HONEYPOT_FIELD = 'website';
export const LIMITS = {
  ...REQUEST_LIMITS,
  voteBodyBytes: 1024,
  requestBodyBytes: 8192,
} as const;
/** Per visitor (hashed), and for everyone together (a ceiling if addresses are spoofed). */
const VOTES_PER_CLIENT = { count: 30, windowMs: 10 * 60_000 };
const VOTES_OVERALL = { count: 600, windowMs: 10 * 60_000 };
const REQUESTS_PER_CLIENT = { count: 5, windowMs: 60 * 60_000 };
const REQUESTS_OVERALL = { count: 100, windowMs: 60 * 60_000 };
/** Where a request sent without JavaScript lands: the page shows its note on :target. */
export const REQUEST_SENT_PATH = '/roadmap/#request-sent';
const MAX_DEDUPE_KEYS = 100_000;

export interface RoadmapOptions {
  /** The SQLite file. Unset (or unopenable): participation is off. Tests pass ':memory:'. */
  dbPath?: string;
  /** The ids people may vote for (src/roadmap.ts `votableIds`). Empty: participation is off. */
  ids: readonly string[];
  /** HMAC key for the in-memory rate-limit keys; a random one per process when unset. */
  salt?: string;
  now?: () => number;
  log?: (line: string) => void;
}

type Reply = { status: number; body: Record<string, unknown> };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS votes (
  id    TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS requests (
  n           INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  email       TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
);`;

/** Open (and create) the roadmap database. Shared with the owner's script. */
export function openRoadmapDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run('PRAGMA busy_timeout = 2000');
  if (path !== ':memory:') db.run('PRAGMA journal_mode = WAL');
  db.run(SCHEMA);
  return db;
}

/** Trimmed text with control characters (other than newlines and tabs) removed. */
function cleanText(value: unknown, multiline: boolean): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n');
  return (multiline ? text : text.replace(/\s+/g, ' ')).trim();
}

export function createRoadmap(options: RoadmapOptions) {
  const { now = Date.now, log = (line) => console.warn(line) } = options;
  const ids = new Set(options.ids);
  const salt = options.salt || randomBytes(32).toString('hex');
  let db: Database | null = null;
  if (options.dbPath && ids.size > 0) {
    try {
      db = openRoadmapDb(options.dbPath);
    } catch (error) {
      log(`roadmap: the database could not be opened (${error instanceof Error ? error.message : 'error'}); voting is off`);
    }
  }
  const live = db !== null;

  const votesPerClient = limiter(VOTES_PER_CLIENT, now);
  const votesOverall = limiter(VOTES_OVERALL, now);
  const requestsPerClient = limiter(REQUESTS_PER_CLIENT, now);
  const requestsOverall = limiter(REQUESTS_OVERALL, now);
  let dedupeDay = '';
  const counted = new Set<string>();

  /** The visitor's key for today: never the address itself, and a new one tomorrow. */
  function visitorKey(req: Request): string {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== dedupeDay) {
      dedupeDay = day;
      counted.clear();
    }
    return createHmac('sha256', salt).update(`${day}|${clientAddress(req)}`).digest('base64url').slice(0, 22);
  }

  const off: Reply = { status: 503, body: { live: false, ok: false, error: 'Voting and requests open soon.' } };
  const tooBig = (req: Request, limit: number) => Number(req.headers.get('content-length') ?? 0) > limit;

  function votes(): Reply {
    if (!db) return off;
    const counts: Record<string, number> = {};
    for (const id of ids) counts[id] = 0;
    for (const row of db.query<{ id: string; count: number }, []>('SELECT id, count FROM votes').all()) {
      if (ids.has(row.id)) counts[row.id] = row.count;
    }
    return { status: 200, body: { live: true, votes: counts } };
  }

  async function vote(req: Request): Promise<Reply> {
    if (!db) return off;
    if (tooBig(req, LIMITS.voteBodyBytes)) return { status: 413, body: { ok: false, error: 'That is more than a vote.' } };
    const key = visitorKey(req);
    if (votesPerClient(key) || votesOverall('*')) {
      return { status: 429, body: { ok: false, error: 'Too many votes in a row. Give it a few minutes.' } };
    }
    const fields = await readFields(req, true);
    if (!fields) return { status: 400, body: { ok: false, error: 'That could not be read. Try again.' } };
    const trap = fields[HONEYPOT_FIELD];
    if (typeof trap === 'string' && trap.trim()) return { status: 200, body: { ok: true, counted: false } };
    const id = typeof fields.id === 'string' ? fields.id : '';
    if (!ids.has(id)) return { status: 400, body: { ok: false, error: 'That is not on the roadmap.' } };
    const dedupe = `${key}:${id}`;
    if (counted.has(dedupe)) {
      const row = db.query<{ count: number }, [string]>('SELECT count FROM votes WHERE id = ?').get(id);
      return { status: 200, body: { ok: true, counted: false, count: row?.count ?? 0 } };
    }
    if (counted.size >= MAX_DEDUPE_KEYS) counted.clear();
    counted.add(dedupe);
    const row = db
      .query<{ count: number }, [string]>(
        'INSERT INTO votes (id, count) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET count = count + 1 RETURNING count',
      )
      .get(id);
    return { status: 200, body: { ok: true, counted: true, count: row?.count ?? 1 } };
  }

  async function request(req: Request, json: boolean): Promise<Reply> {
    if (!db) return off;
    if (tooBig(req, LIMITS.requestBodyBytes)) {
      return { status: 413, body: { ok: false, error: 'That is longer than a request can be.' } };
    }
    const key = visitorKey(req);
    if (requestsPerClient(key) || requestsOverall('*')) {
      return { status: 429, body: { ok: false, error: 'Too many requests in a row. Give it an hour.' } };
    }
    const fields = await readFields(req, json);
    if (!fields) return { status: 400, body: { ok: false, error: 'That could not be read. Try again.' } };
    const trap = fields[HONEYPOT_FIELD];
    if (typeof trap === 'string' && trap.trim()) return { status: 200, body: { ok: true } };
    const title = cleanText(fields.title, false);
    const description = cleanText(fields.description, true);
    if (title.length < LIMITS.title.min || title.length > LIMITS.title.max) {
      return {
        status: 400,
        body: { ok: false, field: 'title', error: `Give it a short title (${LIMITS.title.min} to ${LIMITS.title.max} characters).` },
      };
    }
    if (description.length < LIMITS.description.min || description.length > LIMITS.description.max) {
      return {
        status: 400,
        body: {
          ok: false,
          field: 'description',
          error: `Say a little more about it (${LIMITS.description.min} to ${LIMITS.description.max} characters).`,
        },
      };
    }
    const rawEmail = cleanText(fields.email, false);
    const email = rawEmail ? normalizeEmail(rawEmail) : null;
    if (rawEmail && !email) {
      return { status: 400, body: { ok: false, field: 'email', error: 'That email address does not look right.' } };
    }
    db.query('INSERT INTO requests (created_at, title, description, email) VALUES (?, ?, ?, ?)').run(
      new Date(now()).toISOString(),
      title,
      description,
      email,
    );
    return { status: 200, body: { ok: true } };
  }

  async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const route =
      pathname === '/api/roadmap/votes'
        ? { methods: 'GET, HEAD', run: async () => votes() }
        : pathname === '/api/roadmap/vote'
          ? { methods: 'POST', run: () => vote(req) }
          : pathname === '/api/roadmap/request'
            ? { methods: 'POST', run: () => request(req, wantsJson(req)) }
            : null;
    if (!route) return new Response('Not found', { status: 404 });
    if (!route.methods.split(', ').includes(req.method)) {
      return new Response(null, { status: 405, headers: { Allow: route.methods } });
    }
    let reply: Reply;
    try {
      reply = await route.run();
    } catch (error) {
      // Never the request's text or the visitor's address: only what kind of failure.
      log(`roadmap: ${pathname} failed (${error instanceof Error ? error.name : 'error'})`);
      reply = { status: 500, body: { ok: false, error: 'That did not go through. Try again in a moment.' } };
    }
    // A request form posted without JavaScript gets a page, not JSON.
    if (pathname === '/api/roadmap/request' && req.method === 'POST' && !wantsJson(req)) {
      if (reply.body.ok === true) {
        return new Response(null, { status: 303, headers: { ...NO_STORE, Location: REQUEST_SENT_PATH } });
      }
      return new Response(
        page('Not sent', String(reply.body.error ?? ''), { href: '/roadmap/#request', label: 'Back to the roadmap' }),
        { status: reply.status, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    return Response.json(reply.body, { status: reply.status, headers: NO_STORE });
  }

  return { live, handle, close: () => db?.close() };
}
