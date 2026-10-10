import { describe, expect, test } from 'bun:test';

import { fromAnotherSite, limiter } from './http';

const at = (headers: Record<string, string>) =>
  new Request('http://127.0.0.1:8787/api/subscribe', { method: 'POST', headers });

describe('fromAnotherSite', () => {
  test('compares the page that sent the post with the host it was sent to', () => {
    expect(fromAnotherSite(at({ host: 'rotli.co', origin: 'https://rotli.co' }))).toBe(false);
    expect(fromAnotherSite(at({ host: 'dev.rotli.co', referer: 'https://dev.rotli.co/roadmap/' }))).toBe(false);
    expect(fromAnotherSite(at({ host: 'rotli.co', origin: 'https://dev.rotli.co' }))).toBe(true);
    expect(fromAnotherSite(at({ host: 'rotli.co', origin: 'https://rotli.co.elsewhere.example' }))).toBe(true);
    expect(fromAnotherSite(at({ host: 'rotli.co', origin: 'null' }))).toBe(true);
    expect(fromAnotherSite(at({ host: '127.0.0.1:8787', 'x-forwarded-host': 'rotli.co', origin: 'https://rotli.co' }))).toBe(false);
    // Origin wins over Referer when a browser sends both.
    expect(fromAnotherSite(at({ host: 'rotli.co', origin: 'https://elsewhere.example', referer: 'https://rotli.co/' }))).toBe(true);
  });

  test('a post from no web page at all is left to the rate limits', () => {
    expect(fromAnotherSite(at({ host: 'rotli.co' }))).toBe(false);
  });
});

describe('limiter', () => {
  test('a full map forgets the longest-quiet visitors first, not everyone', () => {
    const limited = limiter({ count: 3, windowMs: 60_000 }, () => 0);
    limited('busy');
    limited('busy');
    for (let i = 0; i < 3000; i++) limited(`early-${i}`);
    expect(limited('busy')).toBe(false); // its third: seen again, so it moves to the recent end
    for (let i = 0; i < 3000; i++) limited(`late-${i}`); // past 5000: the early ones go
    expect(limited('busy')).toBe(true); // its fourth: history kept, so over the limit
    expect(limited('early-0')).toBe(false); // forgotten, starts again
  });
});
