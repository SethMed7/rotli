// The permission differential harness: seeded, deterministic frontmatters
// read by the TypeScript permission readers. The verdicts land in
// scripts/fixtures/permission-differential.json; the Rust suite
// (src-tauri/src/permission_differential_tests.rs) rebuilds the same cases
// from the same sets and fails on any verdict that differs, and
// scripts/permission-differential.test.ts fails when the fixture is stale or
// a case misses a denial that oracle L (below) carries.
//
// Every set is data, so both runtimes build it with three small generators:
//   pool       mulberry32 over `pool`: 1..maxLines entries per case
//   product    each head followed by one tail, then by every pair of tails;
//              `stride` keeps every n-th case (1 keeps all)
//   spelling   every key in every template with every value, in each context
//
//   bun scripts/permission-differential.ts --write           refresh the fixture
//   bun scripts/permission-differential.ts --score           print the score
//   bun scripts/permission-differential.ts --large --out F   a ~120,000-case run;
//     then ROTLI_PERMISSION_DIFFERENTIAL=F cargo test permission_differential
import { readFileSync, writeFileSync } from "node:fs";

import { permissionVerdict } from "../src/lib/permissionVerdict";

export const FIXTURE = new URL("fixtures/permission-differential.json", import.meta.url);

export type CaseSet =
  | { name: string; kind: "pool"; seed: number; count: number; maxLines: number; pool: string[] }
  | { name: string; kind: "product"; stride: number; heads: string[][]; tails: string[] }
  | {
      name: string;
      kind: "spelling";
      templates: [string, string][];
      values: Record<string, string[]>;
      keys: { key: string; values: string; contexts: string[][] }[];
    };

export interface Differential {
  _comment: string;
  sets: CaseSet[];
  verdicts: Record<string, string>;
}

/** mulberry32, as unsigned 32-bit words (the Rust suite's `next`). */
export function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const escapedKey = (key: string) => `\\u${key.charCodeAt(0).toString(16).padStart(4, "0")}${key.slice(1)}`;

export function cases(set: CaseSet): string[][] {
  const out: string[][] = [];
  if (set.kind === "pool") {
    const next = generator(set.seed);
    for (let i = 0; i < set.count; i++) {
      const lines = 1 + (next() % set.maxLines);
      const fields: string[] = [];
      for (let l = 0; l < lines; l++) fields.push(...set.pool[next() % set.pool.length]!.split("\n"));
      out.push(fields);
    }
  } else if (set.kind === "product") {
    let index = 0;
    const keep = (fields: string[]) => {
      if (index++ % set.stride === 0) out.push(fields);
    };
    for (const head of set.heads) {
      for (const a of set.tails) keep([...head, a]);
      for (const a of set.tails) for (const b of set.tails) keep([...head, a, b]);
    }
  } else {
    for (const { key, values, contexts } of set.keys)
      for (const [, template] of set.templates)
        for (const value of set.values[values]!)
          for (const context of contexts) {
            const line = template
              .replaceAll("$K", key)
              .replaceAll("$E", escapedKey(key))
              .replaceAll("$U", key.toUpperCase())
              .replaceAll("$V", value);
            out.push([...context, ...line.split("\n")]);
          }
  }
  return out;
}

export const verdicts = (set: CaseSet) => cases(set).map(permissionVerdict).join("");

// ── oracle L: the plain line rule, independent of the readers under test ──
// A line naming the key in a common spelling (indent, `- `, `? `, quotes,
// `!!str`, a `{…}` flow entry), after splitting on CR, U+2028, U+2029 and
// U+0085 and skipping block-scalar text. Any occurrence that denies counts.
// Ported from the PR #303 triage (oracle L), regexes and all, on purpose,
// plus YAML's plain-scalar folding (review of PR 307, H1): a block key whose
// next non-blank line is deeper, not a comment and not itself `key: value`
// carries that line in its value (`ai_edit: true` + `  until friday` is
// "true until friday"), and a continued `locked`/`secure` value is no plain
// off, so it counts as on.

export interface Intent {
  editDeny: boolean;
  lock: boolean;
  secure: boolean;
  localDeny: boolean;
}

const CREATORS = ["chat", "agent", "librarian"];
const ON = /^(true|yes|on|y)$/i;

export function oracleL(fields: string[]): Intent {
  const found: Record<string, string[]> = {};
  const continuedFlag = new Set<string>();
  let blockIndent = -1;
  const lines = fields.flatMap((l) => l.replace(/\r+$/, "").split(/\r|\u2028|\u2029|\u0085/));
  for (const [at, line] of lines.entries()) {
    const indent = line.length - line.trimStart().length;
    if (blockIndent >= 0 && (line.trim() === "" || indent > blockIndent)) continue;
    blockIndent = -1;
    if (/:\s*[|>][-+0-9]*\s*$/.test(line)) blockIndent = indent;
    const add = (k: string, v: string) =>
      (found[k] ??= []).push(
        v
          .replace(/\s+#.*$/, "")
          .trim()
          .replace(/^(["'])(.*)\1$/, "$2"),
      );
    const block = line.match(/^\s*(?:-\s+)*(?:\?\s+)?(?:!!str\s+)?(["']?)([A-Za-z_]+)\1\s*:(?:\s+(.*))?$/);
    const next = lines.slice(at + 1).find((l) => l.trim() !== "");
    const continued =
      next !== undefined &&
      next.length - next.trimStart().length > indent &&
      !next.trim().startsWith("#") &&
      !/:(\s|$)/.test(next.trim());
    if (block) add(block[2]!, continued ? `${block[3] ?? ""} ${next.trim()}` : (block[3] ?? ""));
    if (block && continued) continuedFlag.add(block[2]!);
    for (const flow of line.matchAll(/[{,]\s*(["']?)([A-Za-z_]+)\1\s*:\s*([^,}]*)/g)) add(flow[2]!, flow[3]!);
  }
  const pick = (k: string, deny: (v: string) => boolean) => {
    const vs = found[k];
    return vs ? { has: true, v: vs.find(deny) ?? vs[0]! } : { has: false, v: "" };
  };
  const notTrue = (v: string) => !/^true$/i.test(v);
  const ai = pick("ai_edit", notTrue);
  const cb = pick("created_by", (v) => !CREATORS.includes(v));
  const lo = pick("locked", (v) => ON.test(v));
  const se = pick("secure", (v) => ON.test(v));
  const la = pick("local_ai_allowed", notTrue);
  const lock = (lo.has && ON.test(lo.v)) || continuedFlag.has("locked");
  return {
    editDeny: lock || (ai.has && notTrue(ai.v)) || (!ai.has && cb.has && !CREATORS.includes(cb.v)),
    lock,
    secure: (se.has && ON.test(se.v)) || continuedFlag.has("secure"),
    localDeny: la.has && notTrue(la.v),
  };
}

/** The dimensions where a verdict grants what the intent denies. */
export function misses(verdict: string, intent: Intent): string[] {
  const out: string[] = [];
  if (intent.editDeny && verdict[0] === "a") out.push("edit");
  if (intent.localDeny && verdict[1] === "t") out.push("local");
  if (intent.lock && verdict[2] !== "1") out.push("lock");
  if (intent.secure && verdict[3] !== "1") out.push("secure");
  return out;
}

/** JSON with every character outside printable ASCII escaped, so the
 * fixture shows each break and odd space it carries. */
export function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replace(/[^\x20-\x7e\n]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)}\n`;
}

/** The committed sets at the larger run's size. */
export function large(sets: CaseSet[]): CaseSet[] {
  return sets.map((set) =>
    set.kind === "pool"
      ? { ...set, count: set.name === "pool303" ? 50000 : 20000 }
      : set.kind === "product"
        ? { ...set, stride: 1 }
        : set,
  );
}

function score(fixture: Differential): void {
  for (const set of fixture.sets) {
    const all = cases(set);
    const verdict = fixture.verdicts[set.name] ?? "";
    const missed: Record<string, number> = {};
    let rows = 0;
    all.forEach((fields, i) => {
      const m = misses(verdict.slice(i * 4, i * 4 + 4), oracleL(fields));
      if (m.length) rows++;
      for (const d of m) missed[d] = (missed[d] ?? 0) + 1;
    });
    console.log(
      `${set.name}: ${all.length} cases, ${rows} miss a denial oracle L carries ${JSON.stringify(missed)}`,
    );
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Differential;
  const sets = args.includes("--large") ? large(fixture.sets) : fixture.sets;
  const next: Differential = {
    ...fixture,
    sets,
    verdicts: Object.fromEntries(sets.map((s) => [s.name, verdicts(s)])),
  };
  if (args.includes("--score")) score(next);
  else if (args.includes("--write") || args.includes("--out")) {
    const out = args.includes("--out") ? args[args.indexOf("--out") + 1]! : FIXTURE;
    writeFileSync(out, stringify(next));
    console.log(
      `wrote ${sets.map((s) => `${s.name} ${next.verdicts[s.name]!.length / 4}`).join(", ")} to ${String(out)}`,
    );
  } else {
    console.error("usage: --write | --score [--large] | --large --out FILE");
    process.exit(2);
  }
}
