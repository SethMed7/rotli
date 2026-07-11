#!/usr/bin/env bun
/**
 * BREVE creator alerts — pings you on Signal when a watched creator uploads.
 * Polls YouTube RSS (no API key, no provider) hourly via its launchd job.
 * Creators live in ../creators.json — managed
 * by hand or via the daemon's /creators command.
 *
 * First sight of a channel baselines it silently (no backfill flood); after
 * that, every unseen video published in the last 36h gets its own message
 * (per-video alerts beat digests — digests pile up).
 */
import { join } from "node:path";
import { BREVE } from "./paths";
import { sendSignal as sendSig } from "./bin";

const DRY = process.env.BREVE_DRY === "1";
const SIGNAL_ENABLED = (process.env.ROTLI_BREVE_LANES ?? "signal").split(",").includes("signal");

const { bot, owner } = await Bun.file(join(BREVE, "signal.json")).json();
const STATE_PATH = join(BREVE, "logs", ".creators-state.json");

type State = { seen: Record<string, number>; baselined: Record<string, boolean> };
const state: State = (await Bun.file(STATE_PATH).json().catch(() => null)) ?? { seen: {}, baselined: {} };
const creators: Array<{ name: string; channelId: string }> = await Bun.file(join(BREVE, "creators.json")).json();

let firstSend = true; // surface a dead signal-cli once, instead of failing silently
async function sendSignal(text: string): Promise<boolean> {
  if (!SIGNAL_ENABLED) return true;
  const ok = await sendSig(bot, owner, text); // resolves signal-cli to an abs path, 3x retry, never throws
  if (!ok && firstSend) console.error("[creators] signal-cli not found — alerts cannot be sent");
  firstSend = false;
  return ok;
}

const FRESH_MS = 36 * 3600_000;
let alerts = 0;

for (const c of creators) {
  let xml: string;
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channelId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { console.error(`[creators] ${c.name}: HTTP ${res.status}`); continue; }
    xml = await res.text();
  } catch (e) {
    console.error(`[creators] ${c.name}: ${e}`);
    continue;
  }
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const fresh: Array<{ id: string; title: string; when: number }> = [];
  for (const e of entries) {
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = e.match(/<title>([^<]*)<\/title>/)?.[1] ?? "(untitled)";
    const when = Date.parse(e.match(/<published>([^<]+)<\/published>/)?.[1] ?? "");
    if (!id) continue;
    if (!state.seen[id] && Date.now() - when < FRESH_MS) fresh.push({ id, title, when });
    state.seen[id] = state.seen[id] ?? Date.now();
  }
  if (!state.baselined[c.channelId]) {
    state.baselined[c.channelId] = true; // first run: record, don't alert
    console.log(`[creators] baselined ${c.name} (${entries.length} videos)`);
    continue;
  }
  for (const v of fresh.sort((a, b) => a.when - b.when)) {
    if (DRY) { alerts++; console.log(`[creators] DRY would alert: ${c.name} — ${v.title}`); continue; }
    const ok = await sendSignal(`▶️ ${c.name} just posted:\n${decodeEntities(v.title)}\nhttps://www.youtube.com/watch?v=${v.id}`);
    if (ok) { alerts++; console.log(`[creators] alerted: ${c.name} — ${v.title}`); }
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// keep state from growing forever
const cutoff = Date.now() - 30 * 86400_000;
for (const [id, ts] of Object.entries(state.seen)) if (ts < cutoff) delete state.seen[id];
if (!DRY) await Bun.write(STATE_PATH, JSON.stringify(state)); // dry runs don't persist — re-runnable
console.log(`[creators] done — ${alerts} ${DRY ? "would-be " : ""}alert(s)`);
