// TS↔Rust shared constants live in scripts/fixtures/parity.json; the REAL
// enforcement is the two hand-written suites (src-tauri/src/parity_tests.rs
// under cargo test, src/lib/parity.test.ts under bun test). This glue only
// guards the harness itself: the fixture stays well-formed, every entry
// declares a source of truth, and every entry key is referenced by BOTH test
// files — so an entry can never silently fall out of coverage.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const violations = [];

const fixturePath = "scripts/fixtures/parity.json";
let fixture;
try {
  fixture = JSON.parse(readFileSync(join(root, fixturePath), "utf8"));
} catch (error) {
  console.error(`${fixturePath} is invalid JSON: ${error.message}`);
  process.exit(1);
}

const entries = fixture?.entries;
if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
  console.error(`${fixturePath}: top-level "entries" object is missing`);
  process.exit(1);
}
for (const [key, entry] of Object.entries(entries)) {
  if (!/^[a-z][A-Za-z0-9]*$/.test(key)) violations.push(`${fixturePath}: entry key "${key}" must be camelCase`);
  if (typeof entry?.sourceOfTruth !== "string" || !entry.sourceOfTruth.trim()) {
    violations.push(`${fixturePath}: "${key}" must declare its sourceOfTruth`);
  }
  if (entry?.value === undefined) violations.push(`${fixturePath}: "${key}" has no value`);
}

const consumers = ["src-tauri/src/parity_tests.rs", "src/lib/parity.test.ts"];
for (const rel of consumers) {
  let text;
  try {
    text = readFileSync(join(root, rel), "utf8");
  } catch {
    violations.push(`missing parity test file: ${rel}`);
    continue;
  }
  for (const key of Object.keys(entries)) {
    if (!text.includes(`"${key}"`)) violations.push(`${rel}: fixture entry "${key}" is never referenced`);
  }
}

if (violations.length) {
  console.error(`parity check failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:parity ok — ${Object.keys(entries).length} fixture entries referenced by both parity test suites`);
