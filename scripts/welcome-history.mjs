// welcome-history — record every shipped Welcome body so the Rust seeder can
// tell an untouched old lesson (safe to refresh) from one the user edited.
//
// Appends the SHA-256 of each current `src/assets/welcome.json` body to
// `src/assets/welcome-history.json`, keyed by the catalog entry id. Hashes are
// only ever added: an old body stays recognizable forever. Run it whenever
// welcome.json changes (`bun scripts/welcome-history.mjs`); the tooling test
// `scripts/welcome-history.test.ts` fails until you do.
//
// The normalization must match `welcome_lessons.rs::body_hash`: CRLF → LF and
// trailing whitespace trimmed, because a saved note round-trips its final
// newline through the frontmatter writer.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const catalogPath = join(root, "src/assets/welcome.json");
const historyPath = join(root, "src/assets/welcome-history.json");

export function welcomeBodyHash(body) {
  return createHash("sha256").update(body.replace(/\r\n?/g, "\n").trimEnd()).digest("hex");
}

export function withCurrentBodies(history, catalog) {
  const next = { ...history };
  for (const entry of catalog) {
    const known = next[entry.id] ?? [];
    const hash = welcomeBodyHash(entry.body);
    next[entry.id] = known.includes(hash) ? known : [...known, hash];
  }
  return next;
}

if (import.meta.main) {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  let history = {};
  try {
    history = JSON.parse(readFileSync(historyPath, "utf8"));
  } catch {
    history = {};
  }
  const next = withCurrentBodies(history, catalog);
  writeFileSync(historyPath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`welcome-history: ${Object.keys(next).length} entries recorded`);
}
