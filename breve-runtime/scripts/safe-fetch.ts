#!/usr/bin/env bun
/**
 * BREVE safe-fetch — the ONE hardened HTTP(S) reader every web fetch goes through.
 *
 * Closes the SSRF/redirect gap that summarize-url.ts and watcher-check.ts had (raw
 * fetch(url,{redirect:'follow'}) to ANY host). Guarantees, for a personal Mac:
 *   • https only (no cleartext, no file:/ftp:/etc), no credentials in the URL
 *   • blocks private / loopback / link-local / ULA / CGNAT / cloud-metadata hosts —
 *     by DNS-RESOLVING the host and checking every resolved IP (not just literals)
 *   • redirects followed MANUALLY, same-host only, bounded (≤ maxRedirects), each hop re-checked
 *   • body stream-capped (~2MB) so a huge/slow response can't exhaust memory
 *   • 20s timeout, neutral browser UA, credentials:'omit' (no cookie beacon)
 *   • strips HTML→text with regex only — no JS, no DOM, no headless browser
 *
 * Returns { ok:true, host, finalUrl, title, text } or { ok:false, reason }. Never throws for a
 * blocked/failed fetch — callers branch on `.ok`. Fetched text is UNTRUSTED data: callers must fence
 * it (never execute or follow instructions inside it) and keep it on the LOCAL tier.
 *
 * KNOWN RESIDUAL (documented v2 follow-up): DNS rebinding — we resolve+check the host, then fetch()
 * resolves again at connect time, so a hostile low-TTL record could differ between the two. For curated
 * public hosts on a single-user Mac the window is narrow; pin-the-IP-and-connect-by-IP is the hardening
 * follow-up (it needs a custom dispatcher / Host-header + SNI handling under Bun's fetch).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// Shared egress caps — mirrored (never imported) by src-tauri/src/web.rs; both sides assert
// equality against scripts/fixtures/egress-fixtures.json (parity by fixture, not shared impl).
export const MAX_FETCH_BYTES = 2_000_000;
export const MAX_REDIRECT_HOPS = 3;
/** URL length cap — an over-long URL (prose stuffed into query params) is an
 *  exfil channel, not a page address (audit 2026-07). `maxUrlChars` in the fixture. */
export const MAX_URL_CHARS = 2048;

export type SafeFetchResult =
  | { ok: true; host: string; finalUrl: string; title: string; text: string }
  | { ok: false; reason: string };

// Private / loopback / link-local / ULA / CGNAT / unspecified — never fetch these from the Mac.
// Exported for the shared egress fixture test (test-safe-fetch-fixtures.ts).
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0 || p[0] === 127 || p[0] === 10) return true;
    if (p[0] === 169 && p[1] === 254) return true;            // link-local incl. 169.254.169.254 metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  if (v === 6) {
    const a = ip.toLowerCase();
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("fc") || a.startsWith("fd")) return true; // fc00::/7 ULA
    const seg0 = parseInt(a.split(":")[0] || "0", 16) || 0;
    if (seg0 >= 0xfe80 && seg0 <= 0xfebf) return true;          // link-local — the FULL fe80::/10, not just fe80:*
    const mapped = ipv4Mapped(a);                               // ::ffff:a.b.c.d in ANY textual form (hex/compressed/uncompressed)
    if (mapped) return isPrivateIp(mapped);
    return false;
  }
  return false;
}

// Return the embedded dotted IPv4 if `a` is an IPv4-mapped IPv6 address (::ffff:a.b.c.d), else null.
// Works on the raw bytes, not a regex, so the hex form (::ffff:0a00:1) and uncompressed form
// (0:0:0:0:0:ffff:10.0.0.1) can't dodge the private-range check the dotted form is subject to.
// `a` is already a valid IPv6 literal (isIP === 6), so the expansion below is total.
function ipv4Mapped(a: string): string | null {
  // fold an embedded dotted tail (::ffff:10.0.0.1) into two hex groups so we have pure hextets
  let s = a.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_m, b1, b2, b3, b4) =>
    `${((Number(b1) << 8) | Number(b2)).toString(16)}:${((Number(b3) << 8) | Number(b4)).toString(16)}`);
  const halves = s.split("::");
  let groups: string[];
  if (halves.length === 2) {
    const l = halves[0] ? halves[0].split(":") : [];
    const r = halves[1] ? halves[1].split(":") : [];
    groups = [...l, ...Array(8 - l.length - r.length).fill("0"), ...r];
  } else {
    groups = s.split(":");
  }
  if (groups.length !== 8) return null;
  const h = groups.map((g) => parseInt(g || "0", 16));
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff)
    return `${(h[6] >> 8) & 0xff}.${h[6] & 0xff}.${(h[7] >> 8) & 0xff}.${h[7] & 0xff}`;
  return null;
}

// Returns a rejection reason, or null if the host is safe to fetch.
// Exported for the shared egress fixture test (test-safe-fetch-fixtures.ts).
export async function hostRejection(host: string): Promise<string | null> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return `blocked host: ${host}`;
  if (isIP(h)) return isPrivateIp(h) ? `private IP blocked: ${host}` : null; // literal IP — allow only if public
  let addrs: Array<{ address: string }>;
  try { addrs = await lookup(h, { all: true }); }
  catch { return `DNS resolution failed: ${host}`; }
  if (!addrs.length) return `no DNS records: ${host}`;
  for (const a of addrs) if (isPrivateIp(a.address)) return `host resolves to a private IP (${a.address}): ${host}`;
  return null;
}

/** Validate a single URL (scheme, no creds, public host). Exported for callers that only gate. */
export async function checkUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  if (raw.length > MAX_URL_CHARS) return { ok: false, reason: "URL too long" };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: "invalid URL" }; }
  if (url.protocol !== "https:") return { ok: false, reason: "https only (cleartext refused)" };
  if (url.username || url.password) return { ok: false, reason: "credentials in URL refused" };
  const bad = await hostRejection(url.hostname);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, url };
}

// Pure per-hop redirect vet: parseable target, https only, SAME host as the first request.
// The loop below applies it before re-entering checkUrl (which re-vets creds + host privacy).
// Exported for the shared egress fixture test (test-safe-fetch-fixtures.ts).
export function redirectRejection(from: URL, location: string, firstHost: string): string | null {
  let next: URL;
  try { next = new URL(location, from); } catch { return "invalid redirect Location"; }
  if (next.protocol !== "https:") return "https only (cleartext refused)";
  if (next.username || next.password) return "credentials in URL refused"; // checkUrl re-vets too — this keeps the pure hop-vet fixture-aligned with Rust
  if (next.hostname.toLowerCase() !== firstHost) return `cross-host redirect refused: ${next.hostname}`;
  return null;
}

function strip(html: string, maxChars: number): { title: string; text: string } {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const text = html
    .replace(/<(script|style|nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n[\s\n]*/g, "\n")
    .trim()
    .slice(0, maxChars);
  return { title, text };
}

// Read the body but ABORT past maxBytes so a huge/slow response can't balloon memory.
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) { out += dec.decode(); break; }
    total += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (total > maxBytes) { await reader.cancel().catch(() => {}); break; }
  }
  return out;
}

export async function safeFetchText(
  raw: string,
  opts: { maxChars?: number; maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const maxChars = opts.maxChars ?? 14000;
  const maxBytes = opts.maxBytes ?? MAX_FETCH_BYTES;
  const timeoutMs = opts.timeoutMs ?? 20000;
  let hops = opts.maxRedirects ?? MAX_REDIRECT_HOPS;
  let current = raw;
  let firstHost = "";
  while (true) {
    const c = await checkUrl(current);
    if (!c.ok) return c;
    const host = c.url.hostname.toLowerCase();
    if (!firstHost) firstHost = host;
    else if (host !== firstHost) return { ok: false, reason: `cross-host redirect refused: ${host}` };
    let res: Response;
    try {
      res = await fetch(c.url.href, {
        headers: { "User-Agent": UA },
        redirect: "manual",
        credentials: "omit",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) { return { ok: false, reason: `fetch failed: ${String(e).slice(0, 80)}` }; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, reason: `redirect with no Location (${res.status})` };
      if (hops-- <= 0) return { ok: false, reason: "too many redirects" };
      const bad = redirectRejection(c.url, loc, firstHost);
      if (bad) return { ok: false, reason: bad };
      current = new URL(loc, c.url).href;
      continue;
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const html = await readCapped(res, maxBytes);
    const { title, text } = strip(html, maxChars);
    return { ok: true, host: firstHost, finalUrl: c.url.href, title, text };
  }
}

// YouTube understanding is currently unavailable. Keep the host check strict so
// callers can distinguish those URLs without substring confusion.
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
export function isYouTubeUrl(raw: string): boolean {
  try { return YT_HOSTS.has(new URL(raw).hostname.toLowerCase()); } catch { return false; }
}

// CLI smoke test: `bun safe-fetch.ts <url>` and `bun safe-fetch.ts --selftest`.
if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === "--selftest") {
    const blocked = ["http://example.com", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://192.168.1.1/", "https://[::1]/", "ftp://example.com", "https://user:pass@example.com/"];
    for (const u of blocked) {
      const r = await checkUrl(u);
      console.log(`${r.ok ? "✗ ALLOWED (should block)" : "✓ blocked"}: ${u}${r.ok ? "" : ` — ${r.reason}`}`);
    }
  } else if (arg) {
    console.log(JSON.stringify(await safeFetchText(arg), null, 2).slice(0, 1200));
  } else {
    console.error("usage: safe-fetch.ts <url> | --selftest");
  }
}
