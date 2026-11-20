// The frontmatter differential harness (review of pull request 303): seeded,
// deterministic frontmatters over the risky alphabet, each read by the
// TypeScript permission readers. The verdicts are written to
// scripts/fixtures/frontmatter-differential.json; the Rust suite rebuilds the
// same cases from the same seed (frontmatter_differential_tests.rs) and fails
// on any verdict that differs, and src/lib/frontmatterDifferential.test.ts
// fails when the fixture is stale or a denial reads as allowed.
//
//   bun scripts/frontmatter-differential.ts --write          refresh the fixture
//   bun scripts/frontmatter-differential.ts --cases 50000 --out <file>
//     a bigger run; then ROTLI_FRONTMATTER_DIFFERENTIAL=<file> cargo test differential
import { readFileSync, writeFileSync } from "node:fs";

import { bodyEdit } from "../src/lib/aiEditPolicy";
import { emptyFrontmatter, isLockedFrontmatter, isSecureFrontmatter } from "../src/lib/frontmatter";
import { frontmatterField, localAiAllowedOverride } from "../src/lib/frontmatterKeys";

export const FIXTURE = new URL("fixtures/frontmatter-differential.json", import.meta.url);

export interface Differential {
  _comment: string;
  seed: number;
  count: number;
  maxLines: number;
  pool: string[];
  verdicts: string;
}

/** mulberry32, as unsigned 32-bit words (frontmatter_differential_tests.rs `next`). */
export function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Case `i` of a run: 1..maxLines pool entries, each split on `\n`. */
export function cases(fixture: Pick<Differential, "seed" | "count" | "maxLines" | "pool">): string[][] {
  const next = generator(fixture.seed);
  const out: string[][] = [];
  for (let i = 0; i < fixture.count; i++) {
    const lines = 1 + (next() % fixture.maxLines);
    const fields: string[] = [];
    for (let l = 0; l < lines; l++) fields.push(...fixture.pool[next() % fixture.pool.length]!.split("\n"));
    out.push(fields);
  }
  return out;
}

const BODY = { allowed: "a", locked: "l", "person-written": "p", revoked: "r" } as const;

/** Four characters: body edit, on-device (t/f/u), locked (1/0), secure (1/0). */
export function verdict(fields: string[]): string {
  const fm = { ...emptyFrontmatter(), foreign: fields };
  const local = localAiAllowedOverride(fields);
  return [
    BODY[bodyEdit(fields)],
    local === null ? "u" : local ? "t" : "f",
    isLockedFrontmatter(fm) ? "1" : "0",
    isSecureFrontmatter(fm) ? "1" : "0",
  ].join("");
}

/** Whether a line in any spelling says no to AI editing, on-device reading,
 * or says the note is locked: such a note must never read as allowed. */
export function carriesDenial(fields: string[]): { edit: boolean; local: boolean } {
  let edit = false;
  let local = false;
  for (const line of fields) {
    const field = frontmatterField(line);
    if (!field) continue;
    if (field.key.name === "ai_edit" && field.value !== "true") edit = true;
    if (field.key.name === "locked" && field.value !== "false") edit = true;
    if (field.key.name === "local_ai_allowed" && field.value !== "true") local = true;
  }
  return { edit, local };
}

export function run(fixture: Pick<Differential, "seed" | "count" | "maxLines" | "pool">): string {
  return cases(fixture).map(verdict).join("");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Differential;
  const count = args.includes("--cases") ? Number(args[args.indexOf("--cases") + 1]) : fixture.count;
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1]! : FIXTURE;
  if (!args.includes("--write") && !args.includes("--out")) {
    console.error("usage: --write, or --cases N --out FILE");
    process.exit(2);
  }
  const next = { ...fixture, count, verdicts: run({ ...fixture, count }) };
  writeFileSync(out, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote ${count} verdicts to ${String(out)}`);
}
