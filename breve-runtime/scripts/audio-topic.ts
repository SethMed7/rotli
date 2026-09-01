#!/usr/bin/env bun
/**
 * BREVE on-demand audio topic brief — "/audio <ask>" from Signal lands here.
 * Usage: bun audio-topic.ts "<request>"
 *
 * The on-device model writes a spoken script with [[voice]] markers; Kokoro
 * voices it (tts.ts). Output: briefs/topics/<slug>-YYYY-MM-DD.mp3 (+ .audio.txt).
 * Prints "OK <mp3path>" on success — the Signal daemon parses that line.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderMp3, parseSegments } from "./tts";
import { AUDIOS, TOPICS } from "./paths";
import { effectiveTz, loadSettings, todayIn } from "./timectx";
import { localGenerate } from "./llm";

const request = process.argv.slice(2).join(" ").trim();
if (!request) { console.error("ERR usage: bun audio-topic.ts \"<request>\""); process.exit(1); }

const date = todayIn(effectiveTz(await loadSettings()));
const slug = request.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 6).join("-") || "topic";
const stem = `${slug}-${date}`;

const PROMPT = `You are Breve, the owner's personal brief engine, producing an ON-DEMAND SPOKEN audio brief they asked for over Signal.

Their request: "${request}"

You are the ON-DEVICE model. You have no live web, repo, filesystem, or cloud-provider access. Never invent
current research; if the request depends on information not included in the request, state that limitation
briefly in the script and give only a cautious, useful treatment from stable knowledge.

THEN OUTPUT ONLY THE SPOKEN SCRIPT — no preamble, no markdown, no headings, no code fences, no URLs. It will be fed directly to text-to-speech.

Script format — a small podcast with named hosts, voice markers each on their own line:
[[anchor]]   — AVA, main host: intro ("Hey, Ava here with your brief on …"), the substance, wrap-up
[[security]] — MARCUS, security correspondent: any security findings, risks, or deadlines the listener must act on (omit if none)
[[personal]] — EMMA, culture host: any personal/non-work angle (omit if none)
Start with [[anchor]]. HANDOFF RULES (exact): each [[marker]] is ONE host speaking in the FIRST PERSON; a host never says their own name (except one optional "Marcus here —" the first time) and never refers to themselves in the third person or thanks themselves. The OUTGOING host's last sentence names the NEXT host ("Marcus, anything the listener should worry about?"); the INCOMING host opens by thanking the previous host by name ("Thanks, Ava.") right AFTER the new marker — the thank-you belongs to whoever receives the mic, never the one handing it off. 350-700 words (2-5 minutes). Plain spoken prose: describe identifiers instead of reading them out, expand abbreviations, no bullet lists. Keep every concrete number, date, and recommendation. End with a one-line sign-off.`;

console.log(`[audio-topic] drafting locally: ${request}`);
const t0 = Date.now();
const out = await localGenerate({ prompt: PROMPT, think: false, options: { num_predict: 2048 } });

let script = out.trim().replace(/^```[a-z]*\n?|\n?```$/g, "").trim();
// If the model added preamble before the first marker, drop it.
const firstMarker = script.search(/^\s*\[\[\s*\w+\s*\]\]\s*$/m);
if (firstMarker > 0) script = script.slice(firstMarker);
if (script.length < 200) {
  console.error("ERR local model produced no usable script");
  process.exit(1);
}
writeFileSync(join(TOPICS, `${stem}.audio.txt`), script + "\n");
const segs = parseSegments(script);
console.log(`[audio-topic] script ready in ${((Date.now() - t0) / 1000).toFixed(0)}s (${script.split(/\s+/).length} words, ${segs.map((s) => s.voice).join(" → ")})`);

const mp3Path = join(AUDIOS, `${stem}.mp3`);
const minutes = await renderMp3(script, mp3Path);
console.log(`OK ${mp3Path} (${(Bun.file(mp3Path).size / 1024 / 1024).toFixed(1)} MB, ${minutes.toFixed(1)} min)`);
