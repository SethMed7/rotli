// The secret-pattern detector exists twice ON PURPOSE (secret.rs is the Rust
// authority; src/ai/guard.ts is the frontend fail-fast mirror — see the note
// at the top of secret.rs). This check makes the hand-sync mechanical: it
// extracts both pattern lists and fails CI the moment they drift.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const violations = [];

function between(text, start, end, file) {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`${file}: marker "${start}" not found`);
  const j = text.indexOf(end, i);
  if (j < 0) throw new Error(`${file}: end marker "${end}" not found`);
  return text.slice(i, j);
}

const guardPath = "src/ai/guard.ts";
const secretPath = "src-tauri/src/secret.rs";
const guard = readFileSync(join(root, guardPath), "utf8");
const secret = readFileSync(join(root, secretPath), "utf8");

// TS: the PATTERNS regex-literal array. `\/` in a literal is a plain `/`.
const tsBlock = between(guard, "const PATTERNS", "];", guardPath);
const tsPatterns = [...tsBlock.matchAll(/^\s*\/(.*)\/,\s*$/gm)].map((m) => m[1].replaceAll("\\/", "/"));

// Rust: the raw strings inside the PATTERNS OnceLock init.
const rsBlock = between(secret, "PATTERNS.get_or_init", ".iter()", secretPath);
const rsPatterns = [...rsBlock.matchAll(/r"([^"]*)"/g)].map((m) => m[1]);

// Guard the extractors themselves — an empty match means the file shape moved,
// not that the lists are in sync.
if (tsPatterns.length < 10)
  violations.push(`${guardPath}: extracted only ${tsPatterns.length} patterns — extractor broken?`);
if (rsPatterns.length < 10)
  violations.push(`${secretPath}: extracted only ${rsPatterns.length} patterns — extractor broken?`);

const max = Math.max(tsPatterns.length, rsPatterns.length);
for (let i = 0; i < max; i++) {
  if (tsPatterns[i] !== rsPatterns[i]) {
    violations.push(
      `pattern ${i} differs:\n      ts: ${tsPatterns[i] ?? "(missing)"}\n      rs: ${rsPatterns[i] ?? "(missing)"}`,
    );
  }
}

// The Luhn-gated PAN pattern is mirrored too.
const tsPan = guard.match(/const PAN = \/(.*)\/g;/)?.[1];
const rsPan = between(secret, "static PAN", "luhn_ok", secretPath).match(/r"([^"]*)"/)?.[1];
if (!tsPan || !rsPan || tsPan !== rsPan) {
  violations.push(`PAN pattern differs: ts=${tsPan ?? "(missing)"} rs=${rsPan ?? "(missing)"}`);
}

if (violations.length) {
  console.error(
    `secret-pattern parity failed (guard.ts must mirror secret.rs):\n${violations.map((line) => `  - ${line}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  `check:secret-parity ok — ${tsPatterns.length} patterns + PAN identical in guard.ts and secret.rs`,
);
