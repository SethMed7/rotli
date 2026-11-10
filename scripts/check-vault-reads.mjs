// check:vault-reads — every read of a vault file's contents goes through the
// one checked open (src-tauri/src/fsutil.rs `open_own_file`, `read_own_text`,
// `read_own_bytes`), which refuses a hard link to a file outside the vault on
// the very descriptor the bytes come from.
//
// The class this guards (second review of PR #267, 2026-11-09): the hard-link
// fix covered note reads, then a reviewer found a dozen other readers that
// opened vault files by path (the organizer's prompt, the memex reader, chat
// transcripts, clipboard images, document conversion …). So every raw read in
// production Rust (`std::fs::read*`, `File::open`, `OpenOptions`, tokio reads)
// outside fsutil.rs must carry a `// raw read: <reason>` marker saying why it
// is not a vault file's contents (app config, a log, a temp file, Rotli's own
// sidecar), and each file may hold only as many markers as
// scripts/vault-read-allowlist.json grants it. Raising a count is a reviewed
// change. Test code is out of scope.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const RAW =
  /\b(?:std::)?fs::(?:read_to_string|read)\s*\(|\bFile::open\s*\(|\bOpenOptions::new\s*\(|\btokio::fs::read/;
const MARKER = /\/\/[ \t]*raw read:[ \t]*\S/;
const OWNER = "fsutil.rs";

/** Production lines of one Rust source: `#[cfg(test)]` items removed. */
export function productionLines(source) {
  const lines = source.split("\n");
  const keep = lines.map(() => true);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "#[cfg(test)]") continue;
    let j = i + 1;
    while (j < lines.length && /^\s*#\[/.test(lines[j])) j += 1;
    if (j >= lines.length) break;
    if (/;\s*$/.test(lines[j]) && !lines[j].includes("{")) {
      for (let k = i; k <= j; k += 1) keep[k] = false;
      continue;
    }
    let depth = 0;
    let opened = false;
    let k = j;
    for (; k < lines.length; k += 1) {
      for (const ch of lines[k]) {
        if (ch === "{") {
          depth += 1;
          opened = true;
        } else if (ch === "}") depth -= 1;
      }
      if (opened && depth <= 0) break;
    }
    for (let m = i; m <= k && m < lines.length; m += 1) keep[m] = false;
    i = k;
  }
  return lines.map((line, index) => (keep[index] ? line : ""));
}

/** Module files declared only for tests: `#[cfg(test)] [#[path = "x.rs"]] mod name;`. */
export function testOnlyFiles(sources) {
  const out = new Set();
  for (const source of sources) {
    for (const m of source.matchAll(
      /#\[cfg\(test\)\]\s*(?:#\[path\s*=\s*"([^"]+)"\]\s*)?(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g,
    )) {
      out.add(m[1] ? basename(m[1]) : `${m[2]}.rs`);
    }
  }
  return out;
}

/** Raw reads in one file: `{ line, text, marked }` for each. */
export function rawReads(source) {
  const lines = productionLines(source);
  const found = [];
  lines.forEach((text, index) => {
    if (text.trim().startsWith("//") || !RAW.test(text)) return;
    const window = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
    found.push({ line: index + 1, text: text.trim(), marked: MARKER.test(window) });
  });
  return found;
}

function rustFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) rustFiles(path, out);
    else if (name.endsWith(".rs")) out.push(path);
  }
  return out;
}

/** Every failure for a source tree and an allowlist of marker counts. */
export function vaultReadFailures(files, allowlist) {
  const testOnly = testOnlyFiles(files.map((f) => f.source));
  const failures = [];
  const counts = {};
  for (const { path, source } of files) {
    const name = basename(path);
    if (name === OWNER || name.endsWith("_tests.rs") || testOnly.has(name)) continue;
    for (const read of rawReads(source)) {
      if (!read.marked) {
        failures.push(
          `${path}:${read.line}: reads a file's contents outside fsutil (${read.text}); use fsutil::read_own_* for a vault file, or mark a non-vault read with \`// raw read: <reason>\``,
        );
      } else counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  for (const [name, count] of Object.entries(counts)) {
    const allowed = allowlist[name] ?? 0;
    if (count > allowed)
      failures.push(
        `${name}: ${count} marked raw reads, allowlist grants ${allowed} (scripts/vault-read-allowlist.json; raising it is a reviewed change)`,
      );
  }
  for (const [name, allowed] of Object.entries(allowlist)) {
    if ((counts[name] ?? 0) < allowed)
      failures.push(
        `${name}: allowlist grants ${allowed} raw reads but ${counts[name] ?? 0} remain; lower it`,
      );
  }
  return failures;
}

if (import.meta.main) {
  const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
  const allowlist = JSON.parse(readFileSync(join(root, "scripts/vault-read-allowlist.json"), "utf8")).files;
  const files = rustFiles(join(root, "src-tauri/src")).map((path) => ({
    path: relative(root, path),
    source: readFileSync(path, "utf8"),
  }));
  const failures = vaultReadFailures(files, allowlist);
  if (failures.length) {
    console.error(`check:vault-reads failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  const total = Object.values(allowlist).reduce((sum, n) => sum + n, 0);
  console.log(
    `check:vault-reads ok — vault contents are read only through fsutil's checked open; ${total} marked non-vault reads in ${Object.keys(allowlist).length} files`,
  );
}
