#!/usr/bin/env bun
/**
 * Send a plain Signal text to the maintainer (the owner) from a shell script — used by the *-brief.sh
 * self-heal path (#18) to RELAY a failure instead of silently producing no brief. Account +
 * recipient come from signal.json (same source the daemon and send-signal-brief.ts use), so the
 * number is never hardcoded. Usage: bun scripts/notify.ts "message text"
 *
 * signal-cli takes a per-account lock; the daemon usually holds it, so we retry a few times.
 */
import { join } from "node:path";

import { claimDelivery, type DeliveryClaim } from "./delivery-claim";
import { safeLockKey } from "./process-lock";

const BREVE = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
const argv = process.argv.slice(2);
const keyIndex = argv.indexOf("--idempotency-key");
const idempotencyKey = keyIndex >= 0 ? argv[keyIndex + 1]?.trim() : undefined;
if (keyIndex >= 0) argv.splice(keyIndex, 2);
const msg = argv.join(" ").trim();
if (!msg) {
  console.error("notify: empty message");
  process.exit(2);
}

const { bot, owner } = await Bun.file(join(BREVE, "signal.json")).json();
let delivery: DeliveryClaim | null = null;
if (idempotencyKey) {
  delivery = await claimDelivery(BREVE, `notifications/${safeLockKey(idempotencyKey)}.signal`);
  if (delivery.status === "delivered") process.exit(0);
  if (delivery.status === "busy") {
    console.error(`notify: ${idempotencyKey} is already in progress`);
    process.exit(75);
  }
  process.on("exit", () => {
    if (delivery?.status === "claimed") delivery.release();
  });
}

for (let i = 0; i < 5; i++) {
  const p = Bun.spawn(["signal-cli", "-a", bot, "send", owner, "-m", msg], {
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await p.exited) === 0) {
    if (delivery?.status === "claimed") await delivery.complete();
    process.exit(0);
  }
  await Bun.sleep(3000); // account lock held by the daemon — wait and retry
}
console.error("notify: gave up after 5 retries");
process.exit(1);
