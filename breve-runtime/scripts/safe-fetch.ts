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

export type SafeFetchResult =
  | { ok: true; host: string; finalUrl: string; title: string; text: string }
  | { ok: false; reason: string };

// Private / loopback / link-local / ULA / CGNAT / unspecified — never fetch these from the Mac.
function isPrivateIp(ip: string): boolean {
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
    if (a.startsWith("fe80")) return true;                      // link-local
    const mapped = a.match(/(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped ::ffff:127.0.0.1
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}

// Returns a rejection reason, or null if the host is safe to fetch.
async function hostRejection(host: string): Promise<string | null> {
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

/** Validate a single URL (scheme, no creds, public host). Exported for callers that only gate (e.g. the agy/YouTube path). */
export async function checkUrl(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: "invalid URL" }; }
  if (url.protocol !== "https:") return { ok: false, reason: "https only (cleartext refused)" };
  if (url.username || url.password) return { ok: false, reason: "credentials in URL refused" };
  const bad = await hostRejection(url.hostname);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, url };
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
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 20000;
  let hops = opts.maxRedirects ?? 3;
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
      current = new URL(loc, c.url).href;
      continue;
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const html = await readCapped(res, maxBytes);
    const { title, text } = strip(html, maxChars);
    return { ok: true, host: firstHost, finalUrl: c.url.href, title, text };
  }
}

// The one allowed non-local processing path is YouTube → agy/Gemini. Host-pin it STRICTLY (by
// hostname, not substring) so a crafted URL can't slip a non-YouTube target into that agentic tier.
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
