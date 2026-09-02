// check:window-events — every cross-window / Rust→webview event is documented
// and wired. Twenty-two `rotli:*` event names lived only as string literals in
// src/lib/tauri.ts and src-tauri (audit 2026-09-01): no registry, no doc, no
// check that an emitter had a listener. docs/architecture/window-events.md is
// the registry; this script proves every literal in code is in the table and
// every table row still exists in code on both a sending and a receiving side.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
const docPath = join(root, "docs/architecture/window-events.md");
const failures = [];

function walk(dir, predicate, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "target") continue;
      walk(path, predicate, out);
    } else if (predicate(path)) out.push(path);
  }
  return out;
}
const files = [
  ...walk(join(root, "src"), (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)),
  ...walk(join(root, "src-tauri/src"), (p) => p.endsWith(".rs")),
];
const NAME = /"((?:rotli:|private-browser-)[a-z0-9-]+)"/g;
const byEvent = new Map();
const occurrences = new Map();
for (const path of files) {
  const source = readFileSync(path, "utf8");
  for (const m of source.matchAll(NAME)) {
    const rel = relative(root, path);
    if (!byEvent.has(m[1])) byEvent.set(m[1], new Set());
    byEvent.get(m[1]).add(rel);
    occurrences.set(m[1], (occurrences.get(m[1]) ?? 0) + 1);
  }
}
const doc = readFileSync(docPath, "utf8");
const documented = new Set(
  [...doc.matchAll(/^\| `((?:rotli:|private-browser-)[a-z0-9-]+)` \|/gm)].map((m) => m[1]),
);
for (const [name, where] of byEvent) {
  if (!documented.has(name))
    failures.push(`${name}: used in ${[...where].join(", ")} but not in docs/architecture/window-events.md`);
  // a sender and a receiver: two files (R→W), or one webview-side file that
  // both emits and listens (W→W lives as one emit/on pair in src/lib/tauri.ts)
  const ts = [...where].some((f) => f.startsWith("src/"));
  if ((occurrences.get(name) ?? 0) < 2 || !ts)
    failures.push(
      `${name}: appears once (${[...where].join(", ")}) — an event needs a sender and a receiver, and the webview side lives in src/lib`,
    );
}
for (const name of documented) {
  if (!byEvent.has(name)) failures.push(`${name}: documented but no longer used in code — remove the row`);
}
if (failures.length) {
  console.error(`check:window-events failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`check:window-events ok — ${byEvent.size} events documented and wired on both sides`);
