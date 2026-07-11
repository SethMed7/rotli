#!/usr/bin/env bun
/**
 * Signal delivery for daily briefs — the audio lands in Seth's Signal as a voice note.
 * Usage: bun send-signal-brief.ts [stem]
 *   stem = YYYY-MM-DD (morning, default today) | YYYY-MM-DD-lunch | YYYY-MM-DD-night
 *
 * Morning includes the Radar yes/no question (writes the pending state for the daemon).
 * NOTE: the daemon may hold the signal-cli account lock — signal-cli waits, so retries cover it.
 */
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { BREVE, BRIEFS, AUDIOS } from "./paths";
import { loadSettings, effectiveTz, todayIn } from "./timectx";

const { bot, owner } = await Bun.file(join(BREVE, "signal.json")).json();

const stem = process.argv[2] ?? todayIn(effectiveTz(await loadSettings()));
const receipts = join(BREVE, "delivery-receipts");
const receipt = join(receipts, `${stem}.signal`);
if (process.env.ROTLI_SCHEDULED === "1" && !process.env.BREVE_REGEN && await Bun.file(receipt).exists()) {
  console.log(`OK ${stem} Signal delivery already recorded`);
  process.exit(0);
}
const kind = stem.endsWith("-lunch") ? "lunch" : stem.endsWith("-night") ? "night" : "morning";
const date = stem.slice(0, 10);
const mp3 = join(AUDIOS, `${stem}.mp3`);
if (!(await Bun.file(mp3).exists())) { console.error(`ERR no mp3 for ${stem}`); process.exit(1); }

let mins = "";
try {
  const p = Bun.spawn(["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", mp3], { stdout: "pipe" });
  const d = parseFloat(await new Response(p.stdout).text());
  await p.exited;
  if (d) mins = ` · ${Math.round(d / 60)} min`;
} catch {}

let text =
  kind === "morning" ? `☕ Good morning — your Breve brief for ${date}${mins}.\nThe PDF is in your email; say "brief" anytime to hear it again.`
  : kind === "lunch" ? `🥪 Lunch Pivot — ${date}${mins}. PDF in your email.`
  : `🌙 Nightcap — ${date}${mins}. PDF in your email.`;

if (kind === "morning") {
  const sugFile = Bun.file(join(BRIEFS, `${date}.suggestion.json`));
  if (await sugFile.exists()) {
    const sug: any = await sugFile.json().catch(() => null);
    if (sug?.name) {
      text += `\n\n📡 Radar: ${sug.name} — ${sug.why}\nKeep an eye on it? Reply yes or no.`;
      await Bun.write(join(BREVE, "signal", "pending-suggestion.json"), JSON.stringify({ ...sug, date }));
    }
  }
}

// Log the delivery into the daemon's conversation transcript, so follow-up chat
// ("the video you mentioned") has the drop in its context.
function logToTranscript() {
  try {
    const dir = join(BREVE, "signal", "transcripts");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}.log`),
      `Breve: ${text.replace(/\n/g, " ")} [delivered ${kind} audio brief ${stem}]\n`);
  } catch {}
}

for (let i = 0; i < 4; i++) {
  const p = Bun.spawn(["signal-cli", "-a", bot, "send", owner, "-m", text, "--attachment", mp3, "--voice-note"], {
    stdout: "ignore", stderr: "pipe",
  });
  const err = await new Response(p.stderr).text();
  if ((await p.exited) === 0) {
    logToTranscript();
    mkdirSync(receipts, { recursive: true });
    await Bun.write(receipt, `${new Date().toISOString()}\n`);
    console.log(`OK sent ${stem} audio to Signal`);
    process.exit(0);
  }
  console.error(`attempt ${i + 1} failed: ${err.slice(0, 120)}`);
  await Bun.sleep(4000);
}
console.error("ERR gave up after 4 attempts");
process.exit(1);
