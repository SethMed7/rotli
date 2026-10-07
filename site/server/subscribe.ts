// The "coming soon" list: one endpoint, /api/subscribe, served by the site's small Bun
// sidecar on 127.0.0.1 behind Caddy (site/server/main.ts, site/Caddyfile `handle /api/*`,
// site/entrypoint.sh). It adds an email address to a Resend segment and nothing else:
// the segment is the list the owner sends Broadcasts to (site/README.md).
//
//   GET/HEAD  /api/subscribe  → { live } — is the list open? If not, the footer says so on submit.
//   POST      /api/subscribe  → adds the contact. JSON in and out for the footer's script;
//                               a plain form post (no JavaScript) is redirected to /subscribed/.
//
// Off unless both RESEND_API_KEY and RESEND_SEGMENT_ID are set: then POST answers 503 and
// the probe says { live: false }. Contacts are global in Resend (one per address), so a
// repeat signup is answered exactly like a new one and only re-checks segment membership.
// A previous unsubscribe is never overridden. Addresses are never logged.
//
// Optional alert (the owner, 2026-10-07): with SUBSCRIBE_ALERT_TO and SUBSCRIBE_ALERT_FROM
// set, each address that newly joins the list (a new contact, or an existing one added to the
// segment) is emailed to the owner through the same Resend account (POST /emails). A repeat
// signup already in the segment sends nothing. The alert never holds up or fails the signup:
// it is sent after the answer is decided, and a failure is logged without the address. The
// recipient lives only in the runtime variable, never in this public repository.

import { clientAddress, limiter, NO_STORE, page, readFields, wantsJson } from './http';

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
  /** Where to email each new signup, and the verified sender to email it from; both or no alert. */
  alertTo?: string;
  alertFrom?: string;
  /** Injected in tests; the real one talks to api.resend.com. */
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  log?: (line: string) => void;
}

type Outcome = { status: number; ok: boolean; error?: string };
/** How an address reached the segment: newly, back after leaving it, or it was already there. */
type Joined = 'new' | 'rejoined' | 'already';

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

async function resendError(res: Response): Promise<{ name: string; message: string }> {
  try {
    const body = (await res.json()) as { name?: unknown; message?: unknown };
    return { name: String(body.name ?? ''), message: String(body.message ?? '') };
  } catch {
    return { name: '', message: '' };
  }
}

const ALREADY = /already (exists|in|a member|added)|duplicate/i;

export function createSubscribe(options: SubscribeOptions = {}): (req: Request) => Promise<Response> {
  const { apiKey, segmentId, now = Date.now, log = (line) => console.warn(line) } = options;
  const alertTo = normalizeEmail(options.alertTo);
  const alertFrom = options.alertFrom?.trim() || null;
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
  async function addContact(email: string): Promise<Joined | null> {
    const created = await resend('/contacts', { email, unsubscribed: false, segments: [{ id: segmentId }] });
    if (created.ok) return 'new';
    const first = await resendError(created);
    if (created.status !== 409 && !ALREADY.test(first.message)) {
      log(`subscribe: resend refused the contact (${created.status} ${first.name || 'error'})`);
      return null;
    }
    const added = await resend(`/contacts/${encodeURIComponent(email)}/segments/${encodeURIComponent(segmentId ?? '')}`);
    if (added.ok) return 'rejoined';
    const second = await resendError(added);
    if (added.status === 409 || ALREADY.test(second.message)) return 'already';
    log(`subscribe: resend refused the segment (${added.status} ${second.name || 'error'})`);
    return null;
  }

  /** Tell the owner who joined. Best effort: never awaited by the signup, never logs the address. */
  async function alert(email: string, joined: Joined): Promise<void> {
    if (!alertTo || !alertFrom || joined === 'already') return;
    const how = joined === 'new' ? 'joined' : 'rejoined';
    try {
      const sent = await resend('/emails', {
        from: alertFrom,
        to: [alertTo],
        subject: `rotli.co: someone ${how} the list`,
        text: `${email} ${how} the rotli.co list (“Hear when it’s ready”).\n\nResend → Audience has the full list.`,
      });
      if (!sent.ok) log(`subscribe: the signup alert was refused (${sent.status} ${(await resendError(sent)).name || 'error'})`);
    } catch (error) {
      log(`subscribe: the signup alert did not send (${error instanceof Error ? error.name : 'error'})`);
    }
  }

  async function subscribe(req: Request, json: boolean): Promise<Outcome> {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return { status: 413, ok: false, error: 'That is more than an email address.' };
    }
    if (perClient(clientAddress(req)) || overall('*')) {
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
      const joined = await addContact(email);
      if (!joined) return { status: 502, ok: false, error: 'That did not go through. Try again in a moment.' };
      void alert(email, joined);
      return { status: 200, ok: true };
    } catch (error) {
      log(`subscribe: resend unreachable (${error instanceof Error ? error.name : 'error'})`);
      return { status: 502, ok: false, error: 'That did not go through. Try again in a moment.' };
    }
  }

  return async (req) => {
    const { pathname } = new URL(req.url);
    if (pathname !== '/api/subscribe') return new Response('Not found', { status: 404 });
    if (req.method === 'GET' || req.method === 'HEAD') {
      return Response.json({ live }, { headers: NO_STORE });
    }
    if (req.method !== 'POST') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
    }
    const json = wantsJson(req);
    const outcome = await subscribe(req, json);
    const headers = NO_STORE;
    if (json) return Response.json({ ok: outcome.ok, error: outcome.error }, { status: outcome.status, headers });
    if (outcome.ok) return new Response(null, { status: 303, headers: { ...headers, Location: SUCCESS_PATH } });
    return new Response(page('Not added', outcome.error ?? ''), {
      status: outcome.status,
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    });
  };
}
