import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSidecar, readVotableIds } from './main';
import { createRoadmap, HONEYPOT_FIELD, LIMITS, openRoadmapDb, REQUEST_SENT_PATH } from './roadmap';

const IDS = ['sheets-beta', 'charts', 'windows'];
const BASE = 'http://127.0.0.1:8787';

function live(extra: Partial<Parameters<typeof createRoadmap>[0]> = {}) {
  return createRoadmap({ dbPath: ':memory:', ids: IDS, salt: 'test-salt', log: () => {}, ...extra });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });
}

function formPost(path: string, fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request(`${BASE}${path}`, { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.9' }, body });
}

const votes = async (roadmap: ReturnType<typeof live>) =>
  (await (await roadmap.handle(new Request(`${BASE}/api/roadmap/votes`))).json()) as {
    live: boolean;
    votes: Record<string, number>;
  };

const REQUEST = { title: 'Kanban for tasks', description: 'A board view over the tasks in my notes.' };

describe('off without a database', () => {
  test('every route answers 503 { live: false } and nothing is created', async () => {
    for (const roadmap of [
      createRoadmap({ ids: IDS, log: () => {} }),
      createRoadmap({ dbPath: ':memory:', ids: [], log: () => {} }),
    ]) {
      expect(roadmap.live).toBe(false);
      const probe = await roadmap.handle(new Request(`${BASE}/api/roadmap/votes`));
      expect(probe.status).toBe(503);
      expect(await probe.json()).toMatchObject({ live: false });
      expect(probe.headers.get('cache-control')).toBe('no-store');
      expect((await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }))).status).toBe(503);
      expect((await roadmap.handle(post('/api/roadmap/request', REQUEST))).status).toBe(503);
    }
  });

  test('an unopenable file is off too, and the log names no visitor data', async () => {
    const lines: string[] = [];
    const roadmap = createRoadmap({ dbPath: '/nonexistent-dir/roadmap.sqlite', ids: IDS, log: (line) => lines.push(line) });
    expect(roadmap.live).toBe(false);
    expect(lines.join('\n')).toContain('voting is off');
  });

  test('a form post while off gets a readable page with a way back', async () => {
    const res = await createRoadmap({ ids: IDS }).handle(formPost('/api/roadmap/request', REQUEST));
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('href="/roadmap/#request"');
  });
});

describe('votes', () => {
  test('counts start at zero for every id on the page', async () => {
    expect(await votes(live())).toEqual({ live: true, votes: { 'sheets-beta': 0, charts: 0, windows: 0 } });
  });

  test('a vote counts once, and the count is returned', async () => {
    const roadmap = live();
    const res = await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, counted: true, count: 1 });
    await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }, { 'cf-connecting-ip': '198.51.100.4' }));
    expect((await votes(roadmap)).votes.charts).toBe(2);
  });

  test('the same visitor voting the same item again the same day is not counted again', async () => {
    let now = Date.UTC(2026, 9, 5, 12);
    const roadmap = live({ now: () => now });
    await roadmap.handle(post('/api/roadmap/vote', { id: 'windows' }));
    const again = await roadmap.handle(post('/api/roadmap/vote', { id: 'windows' }));
    expect(await again.json()).toEqual({ ok: true, counted: false, count: 1 });
    // Another item still counts.
    expect(await (await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }))).json()).toMatchObject({ counted: true });
    // The next UTC day the keys rotate, so the memory of yesterday is gone.
    now += 24 * 60 * 60_000;
    expect(await (await roadmap.handle(post('/api/roadmap/vote', { id: 'windows' }))).json()).toEqual({
      ok: true,
      counted: true,
      count: 2,
    });
  });

  test('an id that is not on the page is refused', async () => {
    const roadmap = live();
    for (const id of ['not-on-the-roadmap', '', 42, null, '__proto__']) {
      const res = await roadmap.handle(post('/api/roadmap/vote', { id }));
      expect(res.status).toBe(400);
    }
    expect(await votes(roadmap)).toEqual({ live: true, votes: { 'sheets-beta': 0, charts: 0, windows: 0 } });
  });

  test('a filled honeypot is answered yes and not counted', async () => {
    const roadmap = live();
    const res = await roadmap.handle(post('/api/roadmap/vote', { id: 'charts', [HONEYPOT_FIELD]: 'x' }));
    expect(await res.json()).toEqual({ ok: true, counted: false });
    expect((await votes(roadmap)).votes.charts).toBe(0);
  });

  test('an oversized or unreadable body is refused', async () => {
    const roadmap = live();
    expect((await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }, { 'content-length': '5000' }))).status).toBe(413);
    const broken = new Request(`${BASE}/api/roadmap/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.50' },
      body: '{nope',
    });
    expect((await roadmap.handle(broken)).status).toBe(400);
  });

  test('rate-limits each visitor, then lets them back in after the window', async () => {
    let now = Date.UTC(2026, 9, 5, 12);
    const roadmap = live({ now: () => now });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await roadmap.handle(post('/api/roadmap/vote', { id: 'nope' }))).status);
    expect(statuses.slice(0, 30).every((status) => status === 400)).toBe(true);
    expect(statuses[30]).toBe(429);
    // Another visitor is unaffected.
    expect((await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }, { 'cf-connecting-ip': '192.0.2.1' }))).status).toBe(200);
    now += 10 * 60_000 + 1;
    expect((await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }))).status).toBe(200);
  });

  test('the wrong method or path is refused', async () => {
    const roadmap = live();
    expect((await roadmap.handle(new Request(`${BASE}/api/roadmap/vote`))).status).toBe(405);
    expect((await roadmap.handle(new Request(`${BASE}/api/roadmap/votes`, { method: 'POST' }))).status).toBe(405);
    expect((await roadmap.handle(new Request(`${BASE}/api/roadmap/requests`))).status).toBe(404);
  });
});

describe('feature requests', () => {
  test('a request is kept with its optional email, and never shown by any route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roadmap-test-'));
    try {
      const dbPath = join(dir, 'roadmap.sqlite');
      const roadmap = live({ dbPath, now: () => Date.UTC(2026, 9, 5, 9, 30) });
      const res = await roadmap.handle(post('/api/roadmap/request', { ...REQUEST, email: ' Ada@Example.COM ' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect((await roadmap.handle(post('/api/roadmap/request', { title: 'Dark sidebar', description: 'Just the sidebar, darker.' }))).status).toBe(200);
      roadmap.close();

      const db = openRoadmapDb(dbPath);
      const rows = db.query('SELECT created_at, title, description, email, status FROM requests ORDER BY n').all();
      db.close();
      expect(rows).toEqual([
        {
          created_at: '2026-10-05T09:30:00.000Z',
          title: 'Kanban for tasks',
          description: 'A board view over the tasks in my notes.',
          email: 'Ada@example.com',
          status: 'new',
        },
        { created_at: '2026-10-05T09:30:00.000Z', title: 'Dark sidebar', description: 'Just the sidebar, darker.', email: null, status: 'new' },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('titles and descriptions must fit their limits, and the field is named', async () => {
    const roadmap = live();
    const cases: [Record<string, unknown>, string][] = [
      [{ ...REQUEST, title: 'ab' }, 'title'],
      [{ ...REQUEST, title: 'x'.repeat(LIMITS.title.max + 1) }, 'title'],
      [{ ...REQUEST, title: 42 }, 'title'],
      [{ ...REQUEST, description: 'too short' }, 'description'],
      [{ ...REQUEST, description: 'x'.repeat(LIMITS.description.max + 1) }, 'description'],
      [{ ...REQUEST, email: 'not-an-email' }, 'email'],
    ];
    for (const [index, [body, field]] of cases.entries()) {
      const res = await roadmap.handle(post('/api/roadmap/request', body, { 'cf-connecting-ip': `192.0.2.${index}` }));
      expect(res.status).toBe(400);
      expect((await res.json()).field).toBe(field);
    }
  });

  test('control characters are dropped and a title is one line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roadmap-test-'));
    try {
      const dbPath = join(dir, 'roadmap.sqlite');
      const roadmap = live({ dbPath });
      await roadmap.handle(post('/api/roadmap/request', { title: 'Two\nlines\u0007', description: 'First line\r\nsecond line\u0000' }));
      roadmap.close();
      const db = openRoadmapDb(dbPath);
      expect(db.query('SELECT title, description FROM requests').get()).toEqual({
        title: 'Two lines',
        description: 'First line\nsecond line',
      });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a filled honeypot is answered yes and dropped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roadmap-test-'));
    try {
      const dbPath = join(dir, 'roadmap.sqlite');
      const roadmap = live({ dbPath });
      const res = await roadmap.handle(post('/api/roadmap/request', { ...REQUEST, [HONEYPOT_FIELD]: 'https://spam.example' }));
      expect(res.status).toBe(200);
      roadmap.close();
      const db = openRoadmapDb(dbPath);
      expect(db.query('SELECT count(*) AS n FROM requests').get()).toEqual({ n: 0 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a body past the cap is refused as it is read, whatever Content-Length says', async () => {
    const roadmap = live();
    const long = { ...REQUEST, description: 'x'.repeat(LIMITS.requestBodyBytes) };
    expect((await roadmap.handle(post('/api/roadmap/request', long))).status).toBe(413);
    expect((await roadmap.handle(post('/api/roadmap/request', long, { 'content-length': '10' }))).status).toBe(413);
    const padded = { id: 'charts', pad: 'x'.repeat(LIMITS.voteBodyBytes) };
    expect((await roadmap.handle(post('/api/roadmap/vote', padded))).status).toBe(413);
    expect((await votes(roadmap)).votes.charts).toBe(0);
  });

  test("another site's page can't vote or file a request", async () => {
    const roadmap = live();
    const elsewhere = { origin: 'https://elsewhere.example' };
    expect((await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }, elsewhere))).status).toBe(403);
    expect((await roadmap.handle(post('/api/roadmap/request', REQUEST, { referer: 'https://elsewhere.example/' }))).status).toBe(403);
    expect((await votes(roadmap)).votes.charts).toBe(0);
    expect((await roadmap.handle(post('/api/roadmap/vote', { id: 'charts' }, { origin: BASE }))).status).toBe(200);
  });

  test('an oversized body is refused before it is read', async () => {
    const res = await live().handle(post('/api/roadmap/request', REQUEST, { 'content-length': String(LIMITS.requestBodyBytes + 1) }));
    expect(res.status).toBe(413);
  });

  test('rate-limits each visitor to five an hour', async () => {
    let now = Date.UTC(2026, 9, 5, 12);
    const roadmap = live({ now: () => now });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await roadmap.handle(post('/api/roadmap/request', REQUEST))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    now += 60 * 60_000 + 1;
    expect((await roadmap.handle(post('/api/roadmap/request', REQUEST))).status).toBe(200);
  });

  test('without JavaScript: success lands back on the page, a failure gets a page with a way back', async () => {
    const roadmap = live();
    const sent = await roadmap.handle(formPost('/api/roadmap/request', { ...REQUEST, [HONEYPOT_FIELD]: '' }));
    expect(sent.status).toBe(303);
    expect(sent.headers.get('location')).toBe(REQUEST_SENT_PATH);
    const refused = await roadmap.handle(formPost('/api/roadmap/request', { title: 'x', description: '' }));
    expect(refused.status).toBe(400);
    const html = await refused.text();
    expect(html).toContain('short title');
    expect(html).toContain('href="/roadmap/#request"');
    expect(html).not.toContain('style');
  });
});

describe('the sidecar', () => {
  test('routes the list and the roadmap, and nothing else', async () => {
    const seen: string[] = [];
    const handler = createSidecar({
      subscribe: async () => (seen.push('subscribe'), new Response('list')),
      roadmap: async () => (seen.push('roadmap'), new Response('roadmap')),
    });
    await handler(new Request(`${BASE}/api/subscribe`));
    await handler(new Request(`${BASE}/api/roadmap/votes`));
    expect((await handler(new Request(`${BASE}/api/other`))).status).toBe(404);
    expect(seen).toEqual(['subscribe', 'roadmap']);
  });

  test('reads the votable ids from the real ROADMAP.md, and none from a missing file', () => {
    const ids = readVotableIds(new URL('../../ROADMAP.md', import.meta.url));
    expect(ids).toContain('sheets-beta');
    expect(ids.length).toBeGreaterThan(10);
    const lines: string[] = [];
    expect(readVotableIds('/nonexistent/ROADMAP.md', (line) => lines.push(line))).toEqual([]);
    expect(lines[0]).toContain('voting is off');
  });
});
