import { describe, expect, test } from 'bun:test';

import { createSubscribe, HONEYPOT_FIELD, normalizeEmail } from './subscribe';

type Call = { url: string; init: RequestInit };

/** A fake Resend: answers each call with the next scripted response and records it. */
function fakeResend(...responses: Response[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected Resend call: ${url}`);
    return next;
  };
  return { calls, fetch };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const CONFIG = { apiKey: 're_test_key', segmentId: 'seg_123' };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://127.0.0.1:8787/api/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });
}

function formPost(fields: Record<string, string>, ip = '203.0.113.8') {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request('http://127.0.0.1:8787/api/subscribe', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
    body,
  });
}

describe('normalizeEmail', () => {
  test('accepts ordinary addresses and lower-cases only the domain', () => {
    expect(normalizeEmail('  Ada.Lovelace+notes@Example.COM ')).toBe('Ada.Lovelace+notes@example.com');
    expect(normalizeEmail('x@sub.example.co.uk')).toBe('x@sub.example.co.uk');
    expect(normalizeEmail('x@xn--bcher-kva.xn--p1ai')).toBe('x@xn--bcher-kva.xn--p1ai');
  });

  test('refuses what is not an address', () => {
    for (const bad of ['', 'plain', 'a@b', 'a@@b.co', 'a b@c.co', '<a@b.co>', 'a@-b.co', 'a@b.c', 42, null, `${'a'.repeat(65)}@b.co`]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});

describe('the live probe', () => {
  test('is off without a key or a segment, and never cached', async () => {
    for (const config of [{}, { apiKey: 're_x' }, { segmentId: 'seg' }]) {
      const res = await createSubscribe(config)(new Request('http://x/api/subscribe'));
      expect(await res.json()).toEqual({ live: false });
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  test('is on with both', async () => {
    const res = await createSubscribe(CONFIG)(new Request('http://x/api/subscribe'));
    expect(await res.json()).toEqual({ live: true });
  });

  test('other methods and paths are refused', async () => {
    const handler = createSubscribe(CONFIG);
    expect((await handler(new Request('http://x/api/subscribe', { method: 'DELETE' }))).status).toBe(405);
    expect((await handler(new Request('http://x/api/other'))).status).toBe(404);
  });
});

describe('subscribing', () => {
  test('creates the contact in the segment', async () => {
    const resend = fakeResend(json({ object: 'contact', id: 'c1' }));
    const res = await createSubscribe({ ...CONFIG, fetch: resend.fetch })(post({ email: 'Ada@Example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resend.calls).toHaveLength(1);
    const [call] = resend.calls;
    expect(call.url).toBe('https://api.resend.com/contacts');
    expect(call.init.method).toBe('POST');
    expect((call.init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(String(call.init.body))).toEqual({
      email: 'Ada@example.com',
      unsubscribed: false,
      segments: [{ id: 'seg_123' }],
    });
  });

  test('a repeat signup only adds the existing contact to the segment, and answers the same', async () => {
    const resend = fakeResend(
      json({ name: 'validation_error', message: 'Contact already exists.' }, 422),
      json({ id: 'seg_123' }),
    );
    const res = await createSubscribe({ ...CONFIG, fetch: resend.fetch })(post({ email: 'ada@example.com' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(resend.calls[1].url).toBe('https://api.resend.com/contacts/ada%40example.com/segments/seg_123');
    expect(resend.calls[1].init.body).toBeUndefined();
  });

  test('a contact already in the segment is still a success (idempotent)', async () => {
    const resend = fakeResend(
      json({ name: 'conflict', message: 'exists' }, 409),
      json({ name: 'validation_error', message: 'Contact is already in this segment.' }, 422),
    );
    const res = await createSubscribe({ ...CONFIG, fetch: resend.fetch })(post({ email: 'ada@example.com' }));
    expect(res.status).toBe(200);
  });

  test('a Resend failure is a 502 and never logs the address', async () => {
    const lines: string[] = [];
    const resend = fakeResend(json({ name: 'invalid_api_key', message: 'API key is invalid' }, 403));
    const res = await createSubscribe({ ...CONFIG, fetch: resend.fetch, log: (line) => lines.push(line) })(
      post({ email: 'secret.person@example.com' }),
    );

    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
    expect(lines.join('\n')).toContain('403 invalid_api_key');
    expect(lines.join('\n')).not.toContain('secret.person');
    expect(lines.join('\n')).not.toContain('example.com');
  });

  test('an unreachable Resend is a 502', async () => {
    const lines: string[] = [];
    const fetch = async () => {
      throw new TypeError('network down');
    };
    const res = await createSubscribe({ ...CONFIG, fetch, log: (line) => lines.push(line) })(post({ email: 'ada@example.com' }));
    expect(res.status).toBe(502);
    expect(lines).toEqual(['subscribe: resend unreachable (TypeError)']);
  });

  test('a bad address is refused before Resend is called', async () => {
    const resend = fakeResend();
    const res = await createSubscribe({ ...CONFIG, fetch: resend.fetch })(post({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not look right/);
    expect(resend.calls).toHaveLength(0);
  });

  test('the list is off without configuration: 503, and Resend is never called', async () => {
    const resend = fakeResend();
    const res = await createSubscribe({ fetch: resend.fetch })(post({ email: 'ada@example.com' }));
    expect(res.status).toBe(503);
    expect(resend.calls).toHaveLength(0);
  });

  test('a filled honeypot is answered yes and dropped', async () => {
    const resend = fakeResend();
    const res = await createSubscribe({ ...CONFIG, fetch: resend.fetch })(
      post({ email: 'bot@example.com', [HONEYPOT_FIELD]: 'https://spam.example' }),
    );
    expect(res.status).toBe(200);
    expect(resend.calls).toHaveLength(0);
  });

  test('an oversized or unreadable body is refused', async () => {
    const handler = createSubscribe({ ...CONFIG, fetch: fakeResend().fetch });
    expect((await handler(post({ email: 'a@b.co' }, { 'content-length': '9000' }))).status).toBe(413);
    const broken = new Request('http://x/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.1' },
      body: '{not json',
    });
    expect((await handler(broken)).status).toBe(400);
  });

  test('a body past the cap is refused as it is read, whatever Content-Length says', async () => {
    const resend = fakeResend();
    const handler = createSubscribe({ ...CONFIG, fetch: resend.fetch });
    const padded = { email: 'a@b.co', pad: 'x'.repeat(20_000) };
    expect((await handler(post(padded))).status).toBe(413);
    expect((await handler(post(padded, { 'content-length': '20' }))).status).toBe(413);
    expect(resend.calls).toHaveLength(0);
  });

  test("another site's page can't sign anyone up, and no alert goes out", async () => {
    const resend = fakeResend(json({ id: 'c_1' }), json({ id: 'e_1' }));
    const handler = createSubscribe({ ...CONFIG, alertTo: 'owner@example.com', alertFrom: 'rotli <alerts@example.com>', fetch: resend.fetch });
    for (const headers of [{ origin: 'https://elsewhere.example' }, { origin: 'null' }, { referer: 'https://elsewhere.example/page' }]) {
      expect((await handler(post({ email: 'a@b.co' }, headers))).status).toBe(403);
    }
    const form = await handler(
      new Request('http://127.0.0.1:8787/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://elsewhere.example' },
        body: 'email=a%40b.co',
      }),
    );
    expect(form.status).toBe(403);
    expect(await form.text()).toContain('Sign up on rotli.co itself.');
    expect(resend.calls).toHaveLength(0);
    // The site's own page, by Origin or by Referer, still gets through.
    expect((await handler(post({ email: 'a@b.co' }, { origin: 'http://127.0.0.1:8787' }))).status).toBe(200);
    await Bun.sleep(0);
    expect(resend.calls.map((call) => new URL(call.url).pathname)).toEqual(['/contacts', '/emails']);
  });

  test('rate-limits each visitor, then lets them back in after the window', async () => {
    let now = 1_000_000;
    const handler = createSubscribe({ ...CONFIG, now: () => now, fetch: fakeResend().fetch });
    const statuses: number[] = [];
    // Bad addresses still count toward the limit and never reach Resend.
    for (let i = 0; i < 6; i++) statuses.push((await handler(post({ email: 'nope' }))).status);
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
    // Another visitor is unaffected.
    expect((await handler(post({ email: 'nope' }, { 'cf-connecting-ip': '192.0.2.1' }))).status).toBe(400);
    now += 10 * 60_000 + 1;
    expect((await handler(post({ email: 'nope' }))).status).toBe(400);
  });
});

describe('the signup alert', () => {
  const ALERT = { ...CONFIG, alertTo: 'owner@example.org', alertFrom: 'rotli <alerts@example.net>' };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('a new contact emails the owner who joined', async () => {
    const resend = fakeResend(json({ object: 'contact', id: 'c1' }), json({ id: 'email_1' }));
    const res = await createSubscribe({ ...ALERT, fetch: resend.fetch })(post({ email: 'Ada@Example.com' }));
    await settle();

    expect(res.status).toBe(200);
    expect(resend.calls).toHaveLength(2);
    const [, sent] = resend.calls;
    expect(sent.url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(sent.init.body));
    expect(body.from).toBe('rotli <alerts@example.net>');
    expect(body.to).toEqual(['owner@example.org']);
    expect(body.subject).toBe('rotli.co: someone joined the list');
    expect(body.text).toContain('Ada@example.com joined');
  });

  test('an existing contact added to the segment is a rejoin; one already in it sends nothing', async () => {
    const rejoin = fakeResend(json({ message: 'Contact already exists.' }, 422), json({ id: 'seg_123' }), json({ id: 'e' }));
    await createSubscribe({ ...ALERT, fetch: rejoin.fetch })(post({ email: 'ada@example.com' }));
    await settle();
    expect(rejoin.calls).toHaveLength(3);
    expect(JSON.parse(String(rejoin.calls[2].init.body)).subject).toBe('rotli.co: someone rejoined the list');

    const already = fakeResend(json({ message: 'exists' }, 409), json({ message: 'Contact is already in this segment.' }, 422));
    const res = await createSubscribe({ ...ALERT, fetch: already.fetch })(post({ email: 'ada@example.com' }));
    await settle();
    expect(res.status).toBe(200);
    expect(already.calls).toHaveLength(2);
  });

  test('a failed alert never fails the signup and never logs the address', async () => {
    const lines: string[] = [];
    const resend = fakeResend(json({ object: 'contact', id: 'c1' }), json({ name: 'validation_error', message: 'domain not verified' }, 403));
    const res = await createSubscribe({ ...ALERT, fetch: resend.fetch, log: (line) => lines.push(line) })(
      post({ email: 'secret.person@example.com' }),
    );
    await settle();

    expect(res.status).toBe(200);
    expect(lines).toEqual(['subscribe: the signup alert was refused (403 validation_error)']);
    expect(lines.join('\n')).not.toContain('secret.person');
  });

  test('is off unless both the recipient and the sender are set, and a bad recipient turns it off', async () => {
    for (const config of [
      { alertTo: 'owner@example.org' },
      { alertFrom: 'rotli <alerts@example.net>' },
      { alertTo: 'not an address', alertFrom: 'rotli <alerts@example.net>' },
    ]) {
      const resend = fakeResend(json({ object: 'contact', id: 'c1' }));
      await createSubscribe({ ...CONFIG, ...config, fetch: resend.fetch })(post({ email: 'ada@example.com' }));
      await settle();
      expect(resend.calls).toHaveLength(1);
    }
  });

  test('a honeypot hit or a refused address sends no alert', async () => {
    const resend = fakeResend();
    const handler = createSubscribe({ ...ALERT, fetch: resend.fetch });
    await handler(post({ email: 'bot@example.com', [HONEYPOT_FIELD]: 'x' }));
    await handler(post({ email: 'nope' }));
    await settle();
    expect(resend.calls).toHaveLength(0);
  });
});

describe('without JavaScript', () => {
  test('a form post that succeeds is redirected to /subscribed/', async () => {
    const resend = fakeResend(json({ object: 'contact', id: 'c1' }));
    const res = await createSubscribe({ ...CONFIG, fetch: resend.fetch })(formPost({ email: 'ada@example.com', [HONEYPOT_FIELD]: '' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/subscribed/');
  });

  test('a form post that fails gets a readable page with a way back', async () => {
    const res = await createSubscribe(CONFIG)(formPost({ email: 'nope' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('does not look right');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('style');
  });
});
