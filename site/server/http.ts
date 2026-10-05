// What every route of the site's sidecar shares (site/server/main.ts): reading a
// JSON or plain form body, a sliding-window rate limiter, and the small HTML
// page a form post without JavaScript gets when it fails.

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
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear(); // never let the map grow without bound
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

export async function readFields(req: Request, json: boolean): Promise<Record<string, unknown> | null> {
  try {
    if (json) {
      const body: unknown = await req.json();
      return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of await req.formData()) if (typeof value === 'string') fields[key] = value;
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
