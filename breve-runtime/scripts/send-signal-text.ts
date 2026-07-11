#!/usr/bin/env bun
/**
 * Send a text Signal message to Seth — used by the lunch/night brief jobs.
 * Usage: bun send-signal-text.ts --file <markdown path> [--prefix "🥪 Title"]
 *        bun send-signal-text.ts --message "text"
 * Markdown is lightly flattened for chat (headers → ▌HEADER, bold/links cleaned).
 * Logs the send into the daemon transcript so follow-up chat has context.
 */
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { BREVE } from "./paths";

const { bot, owner } = await Bun.file(join(BREVE, "signal.json")).json();

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

let text = flag("--message") ?? "";
const file = flag("--file");
if (file) {
  const md = await Bun.file(file).text().catch(() => null);
  if (md === null) { console.error(`ERR cannot read ${file}`); process.exit(1); }
  const flat = md
    .replace(/^#+\s*(.+)$/gm, (_, h) => `▌${h.toUpperCase()}`)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 — $2")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  text = [flag("--prefix"), flat].filter(Boolean).join("\n\n");
}
if (!text.trim()) { console.error("ERR nothing to send"); process.exit(1); }
if (text.length > 8000) text = text.slice(0, 8000) + "\n… (truncated)";

for (let i = 0; i < 4; i++) {
  const p = Bun.spawn(["signal-cli", "-a", bot, "send", owner, "-m", text], { stdout: "ignore", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  if ((await p.exited) === 0) {
    try {
      const dir = join(BREVE, "signal", "transcripts");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}.log`), `Breve: ${text.replace(/\n/g, " ").slice(0, 500)}\n`);
    } catch {}
    console.log("OK sent");
    process.exit(0);
  }
  console.error(`attempt ${i + 1} failed: ${err.slice(0, 120)}`);
  await Bun.sleep(4000);
}
console.error("ERR gave up after 4 attempts");
process.exit(1);
