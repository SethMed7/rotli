// The "coming soon" list: one endpoint, /api/subscribe, run as a small Bun sidecar in the
// site's container on 127.0.0.1 behind Caddy (site/Caddyfile `handle /api/*`,
// site/entrypoint.sh). It adds an email address to a Resend segment and nothing else.
//
//   GET/HEAD  /api/subscribe  → { live } — is the list open? The footer hides its form if not.
//   POST      /api/subscribe  → adds the contact. JSON in and out for the footer's script;
//                               a plain form post (no JavaScript) is redirected to /subscribed/.
//
// Off unless both RESEND_API_KEY and RESEND_SEGMENT_ID are set: then POST answers 503 and
// the probe says { live: false }. Contacts are global in Resend (one per address), so a
// repeat signup is answered exactly like a new one and only re-checks segment membership.
// A previous unsubscribe is never overridden. Addresses are never logged.

const RESEND_API = 'https://api.resend.com';
const MAX_BODY_BYTES = 4096;
const RESEND_TIMEOUT_MS = 8000;
/** Per visitor, and for the whole list (a ceiling if the client address is spoofed). */
const PER_CLIENT = { count: 5, windowMs: 10 * 60_000 };
const OVERALL = { count: 120, windowMs: 10 * 60_000 };
const SUCCESS_PATH = '/subscribed/';
/** The hidden field only bots fill in (SiteFooter.astro). */
export const HONEYPOT_FIELD = 'website';

export interface SubscribeOptions {
  apiKey?: string;
  segmentId?: string;
  /** Injected in tests; the real one talks to api.resend.com. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  log?: (line: string) => void;
}

type Outcome = { status: number; ok: boolean; error?: string };

const EMAIL =
  /^[^\s@"<>()[\]\\,;:]{1,64}@(?=[^@]{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i;

/** A trimmed address with a lower-cased domain, or null when it is not one. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  const at = email.lastIndexOf('@');
  return `${email.slice(0, at)}@${email.slice(at + 1).toLowerCase()}`;
}

/** The visitor's address as Cloudflare → Railway → Caddy hand it over. */
function clientKey(req: Request): string {
  const header = (name: string) => req.headers.get(name)?.split(',')[0]?.trim();
  return header('cf-connecting-ip') || header('x-real-ip') || header('x-forwarded-for') || 'local';
}

function limiter(rule: { count: number; windowMs: number }, now: () => number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < rule.windowMs);
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear(); // never let the map grow without bound
    return recent.length > rule.count;
  };
}

async function readFields(req: Request, json: boolean): Promise<Record<string, unknown> | null> {
  try {
    if (json) {
      const body: unknown = await req.json();
      return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of await req.formData()) if (typeof value === 'string') fields[key] = value;
    return fields;
  } catch {
    return null;
  }
}

async function resendError(res: Response): Promise<{ name: string; message: string }> {
  try {
    const body = (await res.json()) as { name?: unknown; message?: unknown };
    return { name: String(body.name ?? ''), message: String(body.message ?? '') };
  } catch {
    return { name: '', message: '' };
  }
}

const ALREADY = /already (exists|in|a member|added)|duplicate/i;

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title} — rotli</title><body><h1>${title}</h1><p>${body}</p><p><a href="/">Back to rotli</a></p></body></html>`;

export function createSubscribe(options: SubscribeOptions = {}): (req: Request) => Promise<Response> {
  const { apiKey, segmentId, now = Date.now, log = (line) => console.warn(line) } = options;
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const live = Boolean(apiKey && segmentId);
  const perClient = limiter(PER_CLIENT, now);
  const overall = limiter(OVERALL, now);

  async function resend(path: string, body?: unknown): Promise<Response> {
    return send(`${RESEND_API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  }

  /** Create the contact in the segment; an existing contact is only (re)added to it. */
  async function addContact(email: string): Promise<boolean> {
    const created = await resend('/contacts', { email, unsubscribed: false, segments: [{ id: segmentId }] });
    if (created.ok) return true;
    const first = await resendError(created);
    if (created.status !== 409 && !ALREADY.test(first.message)) {
      log(`subscribe: resend refused the contact (${created.status} ${first.name || 'error'})`);
      return false;
    }
    const added = await resend(`/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segmentId ?? '')}`);
    if (added.ok) return true;
    const second = await resendError(added);
    if (added.status === 409 || ALREADY.test(second.message)) return true;
    log(`subscribe: resend refused the segment (${added.status} ${second.name || 'error'})`);
    return false;
  }

  async function subscribe(req: Request, json: boolean): Promise<Outcome> {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return { status: 413, ok: false, error: 'That is more than an email address.' };
    }
    if (perClient(clientKey(req)) || overall('*')) {
      return { status: 429, ok: false, error: 'Too many tries in a row. Give it a few minutes.' };
    }
    const fields = await readFields(req, json);
    if (!fields) return { status: 400, ok: false, error: 'That could not be read. Try again.' };
    // A filled honeypot is a bot: say yes and keep nothing.
    const trap = fields[HONEYPOT_FIELD];
    if (typeof trap === 'string' && trap.trim()) return { status: 200, ok: true };
    const email = normalizeEmail(fields.email);
    if (!email) return { status: 400, ok: false, error: 'That email address does not look right.' };
    if (!live) return { status: 503, ok: false, error: 'The list is not open yet.' };
    try {
      return (await addContact(email))
        ? { status: 200, ok: true }
        : { status: 502, ok: false, error: 'That did not go through. Try again in a moment.' };
    } catch (error) {
      log(`subscribe: resend unreachable (${error instanceof Error ? error.name : 'error'})`);
      return { status: 502, ok: false, error: 'That did not go through. Try again in a moment.' };
    }
  }

  return async (req) => {
    const { pathname } = new URL(req.url);
    if (pathname !== '/api/subscribe') return new Response('Not found', { status: 404 });
    if (req.method === 'GET' || req.method === 'HEAD') {
      return Response.json({ live }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (req.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
    }
    const json =
      (req.headers.get('content-type') ?? '').includes('application/json') ||
      (req.headers.get('accept') ?? '').includes('application/json');
    const outcome = await subscribe(req, json);
    const headers = { 'Cache-Control': 'no-store' };
    if (json) return Response.json({ ok: outcome.ok, error: outcome.error }, { status: outcome.status, headers });
    if (outcome.ok) return new Response(null, { status: 303, headers: { ...headers, Location: SUCCESS_PATH } });
    return new Response(page('Not added', outcome.error ?? ''), {
      status: outcome.status,
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    });
  };
}

// `bun server/subscribe.ts` serves the default export (site/entrypoint.sh starts it).
// Loopback only: Caddy is the one way in.
const env = process.env;
if ((import.meta as { main?: boolean }).main) {
  const open = env.RESEND_API_KEY && env.RESEND_SEGMENT_ID;
  console.log(`subscribe sidecar on 127.0.0.1:${env.SUBSCRIBE_PORT ?? 8787}${open ? '' : ' (list off: RESEND_API_KEY or RESEND_SEGMENT_ID unset)'}`);
}
export default {
  hostname: '127.0.0.1',
  // Never Bun's development error page (stack traces) for a visitor.
  development: false,
  port: Number(env.SUBSCRIBE_PORT ?? 8787),
  fetch: createSubscribe({ apiKey: env.RESEND_API_KEY, segmentId: env.RESEND_SEGMENT_ID }),
};
