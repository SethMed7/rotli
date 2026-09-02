// check:ratchets — numbers that may only move in one direction.
//
// The 2026-09-01 code-quality audit found that nothing measured size, and so
// nothing stopped it: six frontend files over 1,200 lines, one component body
// of 1,174 lines, a 3,548-line Rust impl block, 231 near-duplicate clusters,
// 27 source-string test assertions defending the god files, and 368 dated
// provenance comments that duplicate git blame and rot. Each is recorded here
// as a ceiling; a change may lower a ceiling (run with --update) but never
// raise one. The baseline is scripts/ratchet-baseline.json.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
const baselinePath = join(root, "scripts/ratchet-baseline.json");
const update = process.argv.includes("--update");
const failures = [];

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "target" || name === "dist") continue;
      walk(path, predicate, out);
    } else if (predicate(path)) out.push(path);
  }
  return out;
}
const lines = (path) => readFileSync(path, "utf8").split("\n").length;

// 1. File size: every source file at or above the floor is a ceiling of its own.
const SIZE_FLOOR = 600;
const sizeRoots = ["src", "src-tauri/src", "breve-runtime/scripts", "scripts", "services"];
const isSource = (p) => /\.(ts|tsx|mjs|rs)$/.test(p);
const fileLines = {};
for (const dir of sizeRoots)
  for (const path of walk(join(root, dir), isSource)) {
    const n = lines(path);
    if (n >= SIZE_FLOOR) fileLines[relative(root, path)] = n;
  }

// 2. Source-shape tests: assertions that read a source file as text.
const testFiles = walk(join(root, "src"), (p) => /\.test\.tsx?$/.test(p));
const sourceShapeAssertions = testFiles.reduce(
  (n, p) => n + (readFileSync(p, "utf8").match(/readFileSync\(new URL\(/g) ?? []).length,
  0,
);

// 3. Provenance comments: rationale stays, attribution and phase names do not.
const prodFiles = [
  ...walk(join(root, "src"), isSource),
  ...walk(join(root, "src-tauri/src"), isSource),
].filter((p) => !/\.test\.tsx?$/.test(p));
const count = (re) => prodFiles.reduce((n, p) => n + (readFileSync(p, "utf8").match(re) ?? []).length, 0);
const provenanceComments = {
  maintainerDated: count(/the maintainer, 20\d\d/g),
  phaseOrIncrement: count(/\b(?:Increment|Phase|Track) \d\b/g),
};

// 4. Test coverage floor per src directory (modules : test files), for
// directories large enough for the ratio to mean something.
const COVERAGE_FLOOR = 0.4;
const COVERAGE_MIN_MODULES = 10;
const coverage = {};
for (const entry of readdirSync(join(root, "src"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const all = walk(join(root, "src", entry.name), (p) => /\.tsx?$/.test(p));
  const tests = all.filter((p) => /\.test\.tsx?$/.test(p)).length;
  const modules = all.length - tests;
  if (modules >= COVERAGE_MIN_MODULES) coverage[`src/${entry.name}`] = Number((tests / modules).toFixed(2));
}

const current = { fileLines, sourceShapeAssertions, provenanceComments, coverage };

if (update || !existsSync(baselinePath)) {
  // dupClusters is owned by check:dup --gate; carry it across an update
  const previous = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};
  const next = {
    ...current,
    ...(typeof previous.dupClusters === "number" ? { dupClusters: previous.dupClusters } : {}),
  };
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`check:ratchets — baseline ${update ? "updated" : "created"} at scripts/ratchet-baseline.json`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
for (const [file, n] of Object.entries(fileLines)) {
  const cap = baseline.fileLines[file];
  if (cap === undefined)
    failures.push(
      `${file}: ${n} lines — a new file at or above ${SIZE_FLOOR} lines needs a ceiling (split it, or run --update with a reason in the PR)`,
    );
  else if (n > cap)
    failures.push(
      `${file}: ${n} lines exceeds its ${cap}-line ceiling — split along a seam instead of growing`,
    );
}
for (const file of Object.keys(baseline.fileLines)) {
  if (!(file in fileLines))
    failures.push(`${file}: dropped below ${SIZE_FLOOR} lines or moved — run --update to retire its ceiling`);
}
if (sourceShapeAssertions > baseline.sourceShapeAssertions)
  failures.push(
    `source-shape test assertions rose to ${sourceShapeAssertions} (ceiling ${baseline.sourceShapeAssertions}) — assert behavior, not source text`,
  );
for (const [k, v] of Object.entries(provenanceComments)) {
  if (v > baseline.provenanceComments[k])
    failures.push(
      `${k} comments rose to ${v} (ceiling ${baseline.provenanceComments[k]}) — keep the rationale, drop the attribution/phase name (git blame + CHANGELOG own provenance)`,
    );
}
for (const [dir, ratio] of Object.entries(coverage)) {
  const floor = Math.min(COVERAGE_FLOOR, baseline.coverage[dir] ?? COVERAGE_FLOOR);
  if (ratio < floor) failures.push(`${dir}: ${ratio} test files per module, below its ${floor} floor`);
}
if (failures.length) {
  console.error(`check:ratchets failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `check:ratchets ok — ${Object.keys(fileLines).length} size ceilings held, ${sourceShapeAssertions} source-shape assertions, ${provenanceComments.maintainerDated} dated comments, coverage floors met`,
);
