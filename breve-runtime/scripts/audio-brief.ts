#!/usr/bin/env bun
/**
 * BREVE audio brief — turn any daily brief's markdown into a spoken mp3, fully local.
 * Usage: bun audio-brief.ts [stem]
 *   stem = YYYY-MM-DD (morning) | YYYY-MM-DD-lunch | YYYY-MM-DD-night
 *   (defaults to the latest morning issue)
 *
 * Pipeline: briefs/STEM.md → spoken script (local Gemma via Ollama; regex fallback)
 *           → multi-voice Kokoro TTS (tts.ts) → your storage's breveAudios/STEM.mp3.
 * Morning is a three-host podcast; lunch/night are shorter single-anchor updates
 * (security voice still takes anything urgent). Script saved as briefs/STEM.audio.txt.
 * No API keys, nothing leaves the machine.
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderMp3, parseSegments } from "./tts";
import { stripMarkdown } from "./markdownText";
import { BRIEFS, AUDIOS } from "./paths";
import { LLM } from "./llm";

// 1. Resolve issue
const stemArg = process.argv[2];
const mornings = readdirSync(BRIEFS).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
const stem = stemArg ?? mornings.at(-1)?.replace(".md", "");
if (!stem) { console.error("ERR no briefs found"); process.exit(1); }
const kind: "morning" | "lunch" | "night" = stem.endsWith("-lunch") ? "lunch" : stem.endsWith("-night") ? "night" : "morning";
const date = stem.slice(0, 10);
const mdPath = join(BRIEFS, `${stem}.md`);
const md = await Bun.file(mdPath).text().catch(() => null);
if (!md) { console.error(`ERR no brief markdown at ${mdPath}`); process.exit(1); }

// 2. Spoken script — local Gemma rewrite, stripMarkdown (markdownText.ts) fallback
const niceDate = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

// Shared handoff protocol — prevents hosts referring to themselves in the third person or thanking
// themselves (an earlier bug: Ava's "thanks, Marcus" landed inside Marcus's own block).
const HANDOFF = `HANDOFF PROTOCOL — follow exactly:
- Each [[marker]] starts ONE host speaking, always in the FIRST PERSON ("I", "me"). Markers are the only non-prose lines; each sits alone on its own line.
- A host NEVER says their own name and NEVER refers to themselves in the third person — the ONLY exception is one optional self-intro the first time they speak ("Marcus here —"). Never thank or address yourself.
- To pass the mic: the OUTGOING host's LAST sentence addresses the NEXT host BY NAME ("Marcus, what should the listener watch today?" / "Emma, take us home."). Then the marker switches to that host.
- The INCOMING host's FIRST words thank the host who just spoke, BY THAT host's name ("Thanks, Ava."), then continue. The thank-you ALWAYS belongs to whoever is RECEIVING the mic — it goes AFTER the new marker, never at the end of the previous host's turn.
Worked example:
[[anchor]]
…the big story… Marcus, what needs the listener's attention today?
[[security]]
Thanks, Ava. First, the Node patches… …and that's the security picture. Emma, take us home.
[[personal]]
Thanks, Marcus. On the personal side…`;

const KIND_PROMPTS = {
  morning: `Rewrite today's written brief as a SPOKEN morning audio digest — a small podcast with three named hosts who hand off to each other BY NAME.

THE CAST (marker → host):
[[anchor]]   — AVA, the main host: opener, the big story, industry/company/model news, project updates, sign-off
[[security]] — MARCUS, who handles the security & action-items beat: real vulnerabilities and any concrete deadlines the listener must actually act on — covered PROPORTIONALLY, as ONE beat among many, not the default headline
[[personal]] — EMMA, the culture host: personal section (chess, entertainment, hobbies)
Start the script with [[anchor]]; switch markers whenever the topic class changes (usually 4-6 handoffs total). Never hand off by role ("over to the security desk" is banned) — always by name.

BRIEF VOICE — informational and forward-looking, not alarmist: the goal is to help Seth stay ahead of the curve, not to frighten him. Lead with the single biggest or most interesting story of the day (usually a major AI/model/company/ecosystem move — NOT a security item). Give Marcus's security beat only the space it genuinely warrants; never let warnings set the overall tone. Only include Marcus's [[security]] block when the brief has real security items — if it doesn't, skip that handoff entirely.

${HANDOFF}

Rules:
- 600-800 words total (about 4-5 minutes read aloud).
- Ava opens with: "Good morning — it's Ava, with your Breve brief for ${niceDate}." Then the single biggest or most interesting thing (usually NOT a security item).
- When there ARE security items, Marcus covers "what needs your attention" — keep every concrete date, deadline, and recommendation, but proportionally.
- If the brief has a "Radar" section (a suggested company to start watching), Ava delivers it LAST, right before the sign-off: name it, why it fits, then ask exactly: "Want me to keep an eye on it? Just reply yes or no."
- Ava closes with a one-line sign-off.`,
  lunch: `Rewrite this midday "Pivot" update as a SPOKEN lunch break audio — Ava (the main host, [[anchor]]) carries it, brisk and energizing; Marcus (the security correspondent, [[security]]) takes over ONLY if something urgent or security-related landed, then hands back to Ava. If nothing urgent landed, Ava can carry it throughout with no handoff.

${HANDOFF}

Rules:
- 250-450 words (about 2-3 minutes read aloud).
- Open with: "Hey — Ava here with your lunch pivot for ${niceDate}." Then the delta since this morning.
- Keep every concrete date, number, and recommendation; keep the "rabbit hole" hooks as teasers for tonight.
- Close with one short line.`,
  night: `Rewrite this evening "Nightcap" as a SPOKEN wind-down audio — calm, slower register. Ava ([[anchor]]) carries it; Emma the culture host ([[personal]]) may take personal/cultural items; Marcus ([[security]]) only if something urgent landed since lunch.

${HANDOFF}

Rules:
- 400-650 words (about 3-4 minutes read aloud).
- Open with: "Evening — Ava here with your nightcap for ${niceDate}." Then what moved since lunch.
- Give the "rabbit holes, dug" sections their space — this is the depth slot. Keep every date and recommendation; mention the long-form pick last with why it's worth the evening.
- Close gently — tomorrow's setup, then a one-line goodnight.`,
} as const;

async function gemmaScript(src: string): Promise<string | null> {
  try {
    const res = await fetch(`${LLM.endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM.model,
        stream: false,
        think: false,
        options: { num_ctx: 16384 },
        prompt: `You are Breve, the owner's personal brief narrator. ${KIND_PROMPTS[kind]}

General: output natural spoken prose only — no markdown, no formatting symbols of any kind, no bullet points, no emojis, no URLs. Speak naturally: say identifiers and version numbers only when essential, otherwise describe ("a high-severity Chromium vulnerability"). Expand abbreviations a listener might trip on. Voice markers [[anchor]] / [[security]] / [[personal]] must each sit on their own line.

THE WRITTEN BRIEF:
${src}

THE SPOKEN SCRIPT:`,
      }),
    });
    const j: any = await res.json();
    const out = (j.response ?? "").trim();
    return out.length > 300 ? out : null;
  } catch {
    return null;
  }
}

console.log(`[audio-brief] ${stem} (${kind}) — building spoken script…`);
let script = await gemmaScript(md);
let scriptSource = "gemma";
if (script) {
  // Defensive cleanup: the small 4-bit local model occasionally leaks a stray formatting
  // symbol (or a misspelled instruction word like "astricss") into the spoken script.
  // stripMarkdown deterministically removes formatting symbols/URLs while preserving the
  // [[anchor]]/[[security]]/[[personal]] voice markers (they have no (…) and no *_`>#| chars).
  script = stripMarkdown(script);
} else {
  scriptSource = "fallback-strip";
  const opener = kind === "morning" ? "Good morning" : kind === "lunch" ? "Hey, your lunch pivot" : "Evening, your nightcap";
  script = `${opener} — ${date}. ${stripMarkdown(md)}`.slice(0, 9000);
}
// The saved script file (and the markdown/PDF) must NEVER contain the weekly passphrase — it's
// spoken into the AUDIO only. So persist the clean script, and build a separate `spoken` string.
writeFileSync(join(BRIEFS, `${stem}.audio.txt`), script + `\n\n[source: ${scriptSource}]\n`);
let spoken = script;
const pass = process.env.BREVE_PASSPHRASE;
if (pass && kind === "morning") {
  // Monday step-up passphrase — spoken once, by the security voice, never written to any file.
  spoken += `\n\n[[security]]\nOne private note, just for you: this week's Breve access passphrase is "${pass}". You'll need it to enter a protected space. Keep it to yourself.`;
}
const segs = parseSegments(spoken);
console.log(`[audio-brief] script ready (${script.split(/\s+/).length} words, via ${scriptSource}, ${segs.map((s) => s.voice).join(" → ")})${pass && kind === "morning" ? " +passphrase" : ""}`);

// 3. Render straight into the asset layer (your storage) — the memex keeps only text
const mp3Path = join(AUDIOS, `${stem}.mp3`);
const t0 = Date.now();
const minutes = await renderMp3(spoken, mp3Path);
const size = Bun.file(mp3Path).size;
console.log(`OK ${mp3Path} (${(size / 1024 / 1024).toFixed(1)} MB, ${minutes.toFixed(1)} min, rendered in ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
