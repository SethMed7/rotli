// What every route of the site's sidecar shares (site/server/main.ts): reading a
// JSON or plain form body under a byte cap, refusing a post another site's page
// sent, a sliding-window rate limiter, and the small HTML page a form post
// without JavaScript gets when it fails.

/** The visitor's address as Cloudflare → Railway → Caddy hand it over. Never stored or logged. */
export function clientAddress(req: Request): string {
  const header = (name: string) => req.headers.get(name)?.split(',')[0]?.trim();
  return header('cf-connecting-ip') || header('x-real-ip') || header('x-forwarded-for') || 'local';
}

/** True once `key` has been seen more than `count` times inside the window. Memory only. */
export function limiter(rule: { count: number; windowMs: number }, now: () => number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < rule.windowMs);
    recent.push(t);
    // Re-inserted, so the map runs from least to most recently seen.
    hits.delete(key);
    hits.set(key, recent);
    // Never let the map grow without bound: forget the longest-quiet visitors first,
    // so the busy ones (the ones a limit is for) keep their history.
    for (const quiet of hits.keys()) {
      if (hits.size <= 5000) break;
      hits.delete(quiet);
    }
    return recent.length > rule.count;
  };
}

/** Whether the caller wants JSON back (the pages' scripts) or is a plain form post. */
export function wantsJson(req: Request): boolean {
  return (
    (req.headers.get('content-type') ?? '').includes('application/json') ||
    (req.headers.get('accept') ?? '').includes('application/json')
  );
}

/**
 * True for a post that another site's page sent: its Origin (or, with none, its Referer)
 * names a host other than the one it was sent to. A browser always sends one of them on a
 * cross-site post, so a page elsewhere can't sign someone up, vote, or file a request in
 * their name. A post with neither came from no web page (curl, a script), where there is
 * no visitor's consent to borrow; the rate limits cover those.
 */
export function fromAnotherSite(req: Request): boolean {
  const source = req.headers.get('origin') ?? req.headers.get('referer');
  if (!source) return false;
  // Caddy passes Host through and also names it in X-Forwarded-Host; either is this site.
  const own = [req.headers.get('host') ?? new URL(req.url).host, req.headers.get('x-forwarded-host')];
  try {
    return !own.includes(new URL(source).host);
  } catch {
    return true; // "Origin: null" (a sandboxed frame, a data: page) is never ours
  }
}

/** The body's bytes, read no further than `max` whatever Content-Length claims; null past it. */
async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/**
 * A JSON or plain form body as fields: 'too-big' once it passes `maxBytes` (counted as
 * read, so a missing or understated Content-Length changes nothing), null when unreadable.
 */
export async function readFields(
  req: Request,
  json: boolean,
  maxBytes: number,
): Promise<Record<string, unknown> | 'too-big' | null> {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) return 'too-big';
  try {
    const bytes = await readCapped(req, maxBytes);
    if (!bytes) return 'too-big';
    if (json) {
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    }
    const form = await new Response(bytes, {
      headers: { 'content-type': req.headers.get('content-type') ?? 'application/x-www-form-urlencoded' },
    }).formData();
    const fields: Record<string, unknown> = {};
    for (const [key, value] of form) if (typeof value === 'string') fields[key] = value;
    return fields;
  } catch {
    return null;
  }
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** A bare page for a form post without JavaScript: no styles (the CSP allows none inline). */
export function page(title: string, body: string, back = { href: '/', label: 'Back to rotli' }): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} — rotli</title><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(back.href)}">${escapeHtml(back.label)}</a></p></body></html>`;
}

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
