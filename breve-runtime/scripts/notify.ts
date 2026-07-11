#!/usr/bin/env bun
/**
 * Send a plain Signal text to Seth (the owner) from a shell script — used by the *-brief.sh
 * self-heal path (#18) to RELAY a failure instead of silently producing no brief. Account +
 * recipient come from signal.json (same source the daemon and send-signal-brief.ts use), so the
 * number is never hardcoded. Usage: bun scripts/notify.ts "message text"
 *
 * signal-cli takes a per-account lock; the daemon usually holds it, so we retry a few times.
 */
import { join } from "node:path";

const BREVE = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
const msg = process.argv.slice(2).join(" ").trim();
if (!msg) { console.error("notify: empty message"); process.exit(2); }

const { bot, owner } = await Bun.file(join(BREVE, "signal.json")).json();

for (let i = 0; i < 5; i++) {
  const p = Bun.spawn(["signal-cli", "-a", bot, "send", owner, "-m", msg], { stdout: "ignore", stderr: "pipe" });
  if ((await p.exited) === 0) process.exit(0);
  await Bun.sleep(3000); // account lock held by the daemon — wait and retry
}
console.error("notify: gave up after 5 retries");
process.exit(1);
