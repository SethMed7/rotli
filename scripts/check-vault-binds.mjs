// check:vault-binds — every place production Rust turns a folder path into a
// bound, opened, served, watched, marked or written root says why that path
// is safe under a host build's bundle ID (docs/architecture/host-seams.md,
// "The vault refusal").
//
// The class this guards (PR #329, review rounds 1 to 4): a host build must
// never bind a folder that is, sits in, or holds a Rotli vault it didn't
// mark, and each round a reviewer found one more path that bound a root
// unchecked — the scratch folder, then the registry and legacy pointers,
// then demo mode, then roots re-read from the registry after launch. So
// every call of a binding function carries `// vault bind (<category>):
// <reason>` on its own line or in the comments right above it, and each file may hold only as many of each category as
// scripts/vault-bind-allowlist.json grants it. Two categories are checked
// here as well as counted: `refused` needs a refusal call earlier in the same
// function, and `delegated` is allowed only inside a function that is itself a
// binding function, so its own callers carry markers. Test code is out of
// scope.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { productionLines, testOnlyFiles } from "./check-vault-reads.mjs";

/** The functions that make a path a root, by owner: `module::fn` matches
 * that path (`crate::fn` for `lib`) or an unqualified call in `module.rs`; `Type::fn` matches that
 * path or `Self::fn` in the type's file; `.method` matches a method call. A
 * wrapper of a binding function is one too. */
export const SINKS = [
  "CorpusStore::open",
  "CorpusStore::open_read_only",
  "CorpusStore::open_adopted",
  "CorpusStore::open_raw_folder",
  "CorpusStore::open_raw_file",
  "Workspace::open_target",
  ".insert_root",
  ".activate_new_root",
  ".activate_registered_root",
  ".allow_directory",
  ".allow_file",
  "corpus::spawn_watcher",
  "app_identity::claim",
  "app_identity::claim_for",
  "corpus::persist_corpus_path",
  "corpus::set_corpus_path_live",
  "corpus::upsert_brain",
  "corpus::add_folder",
  "corpus::carry_settings",
  "corpus::relocate",
  "lib::activate_vault_path_live",
  "lib::mount_connected_brain",
  "lib::install_live_root_watcher",
  "helper_vault::read_config",
  "helper_vault::choose_config",
  "helper_vault::choose_config_as",
  "folder_window::open",
];
const TYPE_FILES = { CorpusStore: "corpus.rs", Workspace: "workspace.rs" };

/** Why a bind is safe. Nothing else is. */
export const CATEGORIES = {
  refused: "the path met the vault refusal earlier in this function (checked)",
  vetted: "the path is a root the launch or the CLI already vetted, or a live store's own root",
  delegated: "this function is itself a binding function, so its callers carry the reason (checked)",
  standalone: "reached only when owns_shared_state() is true",
  private: "a folder Rotli made for itself (a temp folder, the app cache)",
};
const MARKER = new RegExp(`//[ \\t]*vault bind \\((${Object.keys(CATEGORIES).join("|")})\\):[ \\t]*\\S`);
const REFUSALS = /\b(?:reject_privileged_root|refuse_existing_vault(?:_for)?|refuse_pinned_root)\s*\(/;
const FN = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sinkNames = new Set(SINKS.map((s) => s.split(/::|\./).pop()));

/** The patterns that find a sink's calls in `file`. */
function sinkPatterns(file) {
  return SINKS.map((sink) => {
    const name = escape(sink.split(/::|\./).pop());
    if (sink.startsWith(".")) return [sink, new RegExp(`\\.${name}\\s*\\(`)];
    const [owner] = sink.split("::");
    const path = owner === "lib" ? "crate" : escape(owner);
    const qualified = `(?:^|[^\\w])${path}::${name}\\s*\\(`;
    const self = TYPE_FILES[owner] === file ? `|\\bSelf::${name}\\s*\\(` : "";
    const local = `${owner}.rs` === file ? `|(?:^|[^\\w.:])${name}\\s*\\(` : "";
    return [sink, new RegExp(qualified + self + local)];
  });
}

/** Binding calls in one file: `{ line, text, sink, fn, category, problem }`. */
export function bindCalls(source, file) {
  const patterns = sinkPatterns(file);
  const lines = productionLines(source);
  const found = [];
  let fnName = null;
  let fnStart = 0;
  lines.forEach((text, index) => {
    const fn = FN.exec(text);
    if (fn) {
      fnName = fn[1];
      fnStart = index;
      return;
    }
    const code = text.replace(/\/\/.*$/, "");
    const sink = patterns.find(([, pattern]) => pattern.test(code))?.[0];
    if (!sink || /^\s*use\s/.test(code)) return;
    let above = index;
    while (above > 0 && lines[above - 1].trim().startsWith("//")) above -= 1;
    const category = MARKER.exec(lines.slice(above, index + 1).join("\n"))?.[1] ?? null;
    let problem = null;
    if (
      category === "refused" &&
      !REFUSALS.test(
        lines
          .slice(fnStart, index + 1)
          .join("\n")
          .replace(/\/\/.*$/gm, ""),
      )
    )
      problem = `marked refused, but nothing in fn ${fnName} refuses the path before this line`;
    if (category === "delegated" && !sinkNames.has(fnName))
      problem = `marked delegated, but fn ${fnName} is not a binding function in scripts/check-vault-binds.mjs SINKS`;
    found.push({ line: index + 1, text: text.trim(), sink, fn: fnName, category, problem });
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
 * file and category: `{ "lib.rs": { "refused": 4 } }`. */
export function vaultBindFailures(files, allowlist) {
  const testOnly = testOnlyFiles(files.map((f) => f.source));
  const failures = [];
  const counts = {};
  for (const { path, source } of files) {
    const name = basename(path);
    if (name.endsWith("_tests.rs") || testOnly.has(name)) continue;
    for (const call of bindCalls(source, name)) {
      const at = `${path}:${call.line}`;
      if (!call.category) {
        failures.push(
          `${at}: ${call.sink}(…) in fn ${call.fn} binds a root without saying why it is safe under a host ID; refuse the path first (reject_privileged_root / refuse_existing_vault) and mark it \`// vault bind (<category>): <reason>\` (categories: ${Object.keys(CATEGORIES).join(", ")})`,
        );
        continue;
      }
      if (call.problem) failures.push(`${at}: ${call.problem}`);
      counts[name] ??= {};
      counts[name][call.category] = (counts[name][call.category] ?? 0) + 1;
    }
  }
  for (const name of new Set([...Object.keys(counts), ...Object.keys(allowlist)])) {
    const have = counts[name] ?? {};
    const granted = allowlist[name] ?? {};
    for (const category of new Set([...Object.keys(have), ...Object.keys(granted)])) {
      const count = have[category] ?? 0;
      const allowed = granted[category] ?? 0;
      if (count > allowed)
        failures.push(
          `${name}: ${count} binds marked ${category}, allowlist grants ${allowed} (scripts/vault-bind-allowlist.json; raising it is a reviewed change)`,
        );
      else if (count < allowed)
        failures.push(`${name}: allowlist grants ${allowed} ${category} binds but ${count} remain; lower it`);
    }
  }
  return failures;
}

if (import.meta.main) {
  const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
  const allowlist = JSON.parse(readFileSync(join(root, "scripts/vault-bind-allowlist.json"), "utf8")).files;
  const files = rustFiles(join(root, "src-tauri/src")).map((path) => ({
    path: relative(root, path),
    source: readFileSync(path, "utf8"),
  }));
  if (process.argv.includes("--list")) {
    for (const { path, source } of files)
      for (const call of bindCalls(source, basename(path)))
        console.log(`${path}:${call.line}\t${call.fn}\t${call.sink}\t${call.category ?? "-"}`);
    process.exit(0);
  }
  const failures = vaultBindFailures(files, allowlist);
  if (failures.length) {
    console.error(`check:vault-binds failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  const total = Object.values(allowlist).reduce(
    (n, granted) => n + Object.values(granted).reduce((a, b) => a + b, 0),
    0,
  );
  console.log(
    `check:vault-binds ok — every root bind says why it is safe under a host ID; ${total} binds in ${Object.keys(allowlist).length} files`,
  );
}
