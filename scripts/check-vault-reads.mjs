// check:vault-reads — every read of a vault file's contents goes through the
// one checked open (src-tauri/src/fsutil.rs `open_own_file`, `read_own_text`,
// `read_own_bytes`, `read_own_sidecar`; containment.rs `open_sidecar`), which
// refuses a hard link to a file outside the vault on the very descriptor the
// bytes come from.
//
// The class this guards (second review of PR #267, 2026-11-09): the hard-link
// fix covered note reads, then a reviewer found a dozen other readers that
// opened vault files by path. So every raw read in production Rust
// (`std::fs::read*`, `File::open`, `OpenOptions`, tokio reads) outside fsutil.rs
// must carry a `// raw read (<category>): <reason>` marker, and each file may
// hold only as many of each category as scripts/vault-read-allowlist.json
// grants it. Raising a count is a reviewed change. Test code, and code built
// only for other platforms (`#[cfg(not(unix))]`), is out of scope.
//
// The third review (2026-11-09) narrowed what may stay raw to five
// categories. A vault sidecar that holds content (settings, journals,
// manifests, users.json) is not one of them: it goes through the checked open.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const RAW =
  /\b(?:std::)?fs::(?:read_to_string|read)\s*\(|\bFile::open\s*\(|\bOpenOptions::new\s*\(|\btokio::fs::read/;
/** Why a raw read may stay raw. Nothing else does. */
export const CATEGORIES = {
  identity: "a vault's identity or marker file (memex.json, the role marker), or an identity comparison",
  "outside-vault": "app and provider config, logs and caches outside any vault",
  import: "a file the person chose to bring in from outside the vault",
  "private-output": "Rotli's own output in a private temp folder",
  "dir-sync": "a directory opened only to sync it",
};
const MARKER = new RegExp(`//[ \\t]*raw read \\((${Object.keys(CATEGORIES).join("|")})\\):[ \\t]*\\S`);
const OWNER = "fsutil.rs";

/** Production lines of one Rust source: `#[cfg(test)]` items removed. */
export function productionLines(source) {
  const lines = source.split("\n");
  const keep = lines.map(() => true);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "#[cfg(test)]" && lines[i].trim() !== "#[cfg(not(unix))]") continue;
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

/** Raw reads in one file: `{ line, text, marked, category }` for each. */
export function rawReads(source) {
  const lines = productionLines(source);
  const found = [];
  lines.forEach((text, index) => {
    if (text.trim().startsWith("//") || !RAW.test(text)) return;
    const window = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
    const category = MARKER.exec(window)?.[1] ?? null;
    found.push({ line: index + 1, text: text.trim(), marked: category !== null, category });
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

/** Every failure for a source tree and an allowlist of marker counts per
 * file and category: `{ "memex.rs": { "identity": 2 } }`. */
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
          `${path}:${read.line}: reads a file's contents outside fsutil (${read.text}); use fsutil::read_own_* for a vault file, or mark a read that may stay raw with \`// raw read (<category>): <reason>\` (categories: ${Object.keys(CATEGORIES).join(", ")})`,
        );
      } else {
        counts[name] ??= {};
        counts[name][read.category] = (counts[name][read.category] ?? 0) + 1;
      }
    }
  }
  const keys = new Set([...Object.keys(counts), ...Object.keys(allowlist)]);
  for (const name of keys) {
    const have = counts[name] ?? {};
    const granted = allowlist[name] ?? {};
    for (const category of new Set([...Object.keys(have), ...Object.keys(granted)])) {
      const count = have[category] ?? 0;
      const allowed = granted[category] ?? 0;
      if (count > allowed)
        failures.push(
          `${name}: ${count} raw reads marked ${category}, allowlist grants ${allowed} (scripts/vault-read-allowlist.json; raising it is a reviewed change)`,
        );
      else if (count < allowed)
        failures.push(
          `${name}: allowlist grants ${allowed} ${category} raw reads but ${count} remain; lower it`,
        );
    }
  }
  return failures;
}

/** The allowlist's totals per category. */
export function categoryTotals(allowlist) {
  const totals = {};
  for (const granted of Object.values(allowlist))
    for (const [category, count] of Object.entries(granted))
      totals[category] = (totals[category] ?? 0) + count;
  return totals;
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
  const totals = categoryTotals(allowlist);
  const total = Object.values(totals).reduce((sum, n) => sum + n, 0);
  console.log(
    `check:vault-reads ok — vault contents are read only through the checked open; ${total} raw reads in ${Object.keys(allowlist).length} files (${Object.entries(
      totals,
    )
      .map(([category, n]) => `${category} ${n}`)
      .join(", ")})`,
  );
}
