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
// Window targeting (review of PR 199): a bare `listen()` hears an event emitted
// to ANY window, and Rust's `.emit()` sends to every window. So Rust must
// address events per window (`emit_to`; only true broadcasts may `.emit`), and
// every event Rust addresses must be heard with `listenHere` or a `target`.
const BROADCASTS = new Set(["rotli:vault-changed"]);
const constants = new Map();
const addressed = new Set();
for (const path of files.filter((p) => p.endsWith(".rs"))) {
  const source = readFileSync(path, "utf8");
  for (const m of source.matchAll(/const ([A-Z_]+): &str = "(rotli:[a-z0-9-]+)"/g)) constants.set(m[1], m[2]);
}
const eventOf = (token) => (token.startsWith('"') ? token.slice(1, -1) : constants.get(token));
for (const path of files.filter((p) => p.endsWith(".rs"))) {
  const source = readFileSync(path, "utf8");
  const rel = relative(root, path);
  for (const m of source.matchAll(/\.emit\(\s*("rotli:[a-z0-9-]+"|[A-Z_]+_EVENT)/g)) {
    const name = eventOf(m[1]);
    if (name && !BROADCASTS.has(name))
      failures.push(
        `${rel}: \`.emit(${m[1]})\` reaches every window — use emit_to(<label>, …) (or list a true broadcast)`,
      );
  }
  for (const m of source.matchAll(/emit_to(?:_shells)?\([^;]*?("rotli:[a-z0-9-]+"|[A-Z_]+_EVENT)/gs)) {
    const name = eventOf(m[1]);
    if (name) addressed.add(name);
  }
}
for (const path of files.filter((p) => /\.tsx?$/.test(p))) {
  const source = readFileSync(path, "utf8");
  for (const m of source.matchAll(/\blisten(?:<[^>]*>)?\(\s*"(rotli:[a-z0-9-]+)"/g)) {
    if (!addressed.has(m[1])) continue;
    // the whole call, by balanced parentheses (handlers hold their own calls)
    let depth = 0;
    let end = source.indexOf("(", m.index);
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")" && --depth === 0) break;
    }
    if (!source.slice(m.index, end).includes("target:"))
      failures.push(
        `${relative(root, path)}: ${m[1]} is addressed to one window by Rust — hear it with listenHere (or a target), not a bare listen`,
      );
  }
}

for (const name of documented) {
  if (!byEvent.has(name)) failures.push(`${name}: documented but no longer used in code — remove the row`);
}
if (failures.length) {
  console.error(`check:window-events failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `check:window-events ok — ${byEvent.size} events documented and wired on both sides; ${addressed.size} window-addressed events heard per window`,
);
