/**
 * BREVE step-up auth — for the ADMIN entering a BOUND user's space.
 *
 * Two factors, both required (per the RBAC design):
 *   1. a per-access 6-digit code, emailed to the admin (Resend) — proves possession of the inbox;
 *   2. the WEEK'S PASSPHRASE — a word, rotated every Monday, spoken ONLY in the Monday audio brief.
 *
 * No DB — everything local, by sensitivity (the owner's choice):
 *   • the passphrase HASH lives in the breve keychain (sandbox-denied; no persona/model can read it).
 *     We store only an argon2 hash + the week stamp — never the plaintext word, which is ephemeral
 *     (generated Monday, spoken once over audio, then gone).
 *   • the 2FA code is in-memory in the daemon (never on disk), short TTL.
 *   • who's bound / roles live in access.json (policy); the access AUDIT trail appends to the memex.
 */
import { randomInt } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { readSecret, writeSecret } from "./secret";
import { knowledgePath } from "./config";

const BREVE = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
const PASS_SERVICE = "breve-weekly-pass"; // keychain: JSON { hash, week }

/** The current week's stamp = the date of this week's Monday (stable Mon–Sun). */
export function weekId(d = new Date()): string {
  const x = new Date(d);
  const back = (x.getDay() + 6) % 7; // Mon=0 … Sun=6
  x.setDate(x.getDate() - back);
  return x.toISOString().slice(0, 10);
}

// Curated, easy-to-hear words (no homophones/ambiguity over TTS). Pick one per week.
const WORDS = [
  "harbor", "lantern", "cobalt", "thistle", "marble", "ember", "willow", "compass",
  "saffron", "glacier", "juniper", "verdant", "cinder", "harvest", "meadow", "quartz",
  "tidal", "sparrow", "amber", "cypress", "basalt", "nectar", "dapple", "ferns",
  "monsoon", "trellis", "almond", "beacon", "driftwood", "fennel", "garnet", "hollow",
];

/** Generate this week's passphrase, store ONLY its hash + week in the keychain, return the plaintext
 *  ONCE (for the audio brief to speak — the caller must never write it to disk). */
export async function rotatePassphrase(): Promise<string> {
  const word = WORDS[randomInt(0, WORDS.length)];
  const hash = await Bun.password.hash(word); // argon2id, salted
  await writeSecret(PASS_SERVICE, JSON.stringify({ hash, week: weekId() }));
  return word;
}

/** Verify an entered passphrase against this week's stored hash. Case/space-insensitive. */
export async function verifyPassphrase(input: string): Promise<boolean> {
  try {
    const raw = await readSecret(PASS_SERVICE);
    if (!raw) return false;
    const { hash } = JSON.parse(raw);
    return hash ? await Bun.password.verify(input.trim().toLowerCase(), hash) : false;
  } catch { return false; }
}

/** Is a current-week passphrase set? (false ⇒ Monday rotation hasn't run / keychain empty.) */
export async function passphraseReady(): Promise<boolean> {
  try {
    const raw = await readSecret(PASS_SERVICE);
    if (!raw) return false;
    return JSON.parse(raw).week === weekId();
  } catch { return false; }
}

/** A fresh 6-digit code (crypto-strong). */
export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Email a step-up code to the admin (Resend → recipients.json `to`). Returns false on any failure. */
export async function emailCode(code: string, user: string): Promise<boolean> {
  try {
    const apiKey = await readSecret("resend-breve");
    if (!apiKey) return false;
    const cfg = JSON.parse(readFileSync(join(BREVE, "recipients.json"), "utf8"));
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.from,
        to: cfg.to,
        subject: `🔐 Breve access code: ${code}`,
        text: `Your one-time code to enter the "${user}" space is ${code}.\nIt expires in 10 minutes. If you didn't request this, ignore it — access was not granted.`,
      }),
    });
    return res.ok;
  } catch { return false; }
}

/** Append a non-secret line to the access audit (the memex — the owner's home, durable knowledge). */
export function audit(line: string): void {
  try {
    appendFileSync(join(knowledgePath(), "access-log.md"), `- ${new Date().toISOString()} — ${line}\n`);
  } catch { /* never block auth on an audit-write failure */ }
}

// CLI: `bun scripts/auth.ts rotate` → rotate + PRINT the plaintext word (for the Monday audio script
// to speak; the word is never persisted). `bun scripts/auth.ts ready` → exit 0 if this week is set.
if (import.meta.main) {
  const cmd = Bun.argv[2];
  if (cmd === "rotate") { process.stdout.write(await rotatePassphrase()); }
  else if (cmd === "ready") { process.exit((await passphraseReady()) ? 0 : 1); }
  else { console.error("usage: bun scripts/auth.ts rotate | ready"); process.exit(1); }
}
