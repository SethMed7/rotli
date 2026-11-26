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
// every call of a binding function, and of a registry reader (the registry
// can be rewritten while the app runs), carries `// vault bind (<category>):
// <reason>` on its own line or in the comments right above it, and each file
// may hold only as many of each category as scripts/vault-bind-allowlist.json
// grants it. Three categories are checked here as well as counted:
// `refused` needs a refusal call, and `live` a host_registry::live_* call,
// that names the same variable as the marked call (through `let` bindings),
// before a bind in a block that encloses it, or after a registry read in the
// read's own block; `delegated` is allowed only inside a function that is
// itself on one of the two lists, so its own callers carry markers. Calls
// through an alias (`use … as`, a plain or glob `use` of a sink, a type
// alias) and a sink passed as a value (`.map(CorpusStore::open)`) are found
// too. Test code is out of scope.
//
// This is a line-and-brace heuristic, a tripwire and not a proof: it does not
// follow control flow (an early return, a refusal whose error is dropped), a
// variable reassigned without `let`, or a call written in UFCS form
// (`CorpusState::insert_root(&state, …)`). A reviewer still reads each marker.
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
/** The registry readers. Anything that writes the support folder can rewrite
 * what they return while the app runs, so a folder taken from them is a root
 * source like any other. */
export const SOURCES = [
  "corpus::resolve_corpus",
  "corpus::read_corpus_config",
  "corpus::ensure_corpus_config",
  "corpus::read_config_path",
  "corpus::read_config_path_or_backup",
  "corpus::read_dev_source_config",
  "corpus::default_corpus_root",
  "workspace::read_config",
];
/** A registry parsed straight from JSON, outside the readers above, is a source too. */
const PARSE = "serde_json::<CorpusConfig>";
const TYPE_FILES = { CorpusStore: "corpus.rs", Workspace: "workspace.rs" };

/** Why a bind is safe. Nothing else is. */
export const CATEGORIES = {
  refused: "the path meets the vault refusal in this function, before a bind uses it (checked)",
  vetted: "the path is a root the launch or the CLI already vetted, or a live store's own root",
  live: "a host takes the root from its open stores: a host_registry::live_* call (checked)",
  "no-root": "takes no folder from what it reads: ids, perms, an existence probe, the registry's own rewrite",
  delegated:
    "this function is itself a binding function or registry reader, so its callers carry the reason (checked)",
  standalone: "reached only when owns_shared_state() is true",
  private: "a folder Rotli made for itself (a temp folder, the app cache)",
};
const MARKER = new RegExp(`//[ \\t]*vault bind \\((${Object.keys(CATEGORIES).join("|")})\\):[ \\t]*\\S`);
const REFUSALS = /\b(?:reject_privileged_root|refuse_existing_vault(?:_for)?|refuse_pinned_root)\s*\(/g;
const LIVE = /\bhost_registry::live_\w+\s*\(/g;
const FN = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/;
const KEYWORDS = new Set(
  "let mut ref if else match for in while loop return move as true false crate super self fn async unsafe where impl dyn break continue use pub const static type struct enum app identifier".split(
    " ",
  ),
);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sinkNames = new Set([...SINKS, ...SOURCES].map((s) => s.split(/::|\./).pop()));

/** `use` items in a file: `{ segs, local, glob }`, braces expanded. */
function importsOf(source) {
  const out = [];
  const expand = (tree, prefix) => {
    const brace = tree.indexOf("{");
    if (brace === -1) {
      const [path, alias] = tree.split(/\s+as\s+/);
      const segs = [...prefix, ...path.split("::").filter(Boolean)];
      const glob = segs.at(-1) === "*";
      if (glob || segs.at(-1) === "self") segs.pop();
      out.push({ segs, local: alias ?? segs.at(-1), glob });
      return;
    }
    const head = tree.slice(0, brace).split("::").filter(Boolean);
    let depth = 0;
    let from = brace + 1;
    for (let i = brace + 1; i < tree.length; i += 1) {
      if (tree[i] === "{") depth += 1;
      else if (tree[i] === "}" && depth-- === 0) {
        if (tree.slice(from, i).trim()) expand(tree.slice(from, i).trim(), [...prefix, ...head]);
        return;
      } else if (tree[i] === "," && depth === 0) {
        if (tree.slice(from, i).trim()) expand(tree.slice(from, i).trim(), [...prefix, ...head]);
        from = i + 1;
      }
    }
  };
  for (const m of source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm))
    expand(
      m[1]
        .replace(/\s+/g, " ")
        .replace(/\s*(::|[{},])\s*/g, "$1")
        .trim(),
      [],
    );
  return out;
}

/** The local names `file` reaches each sink's owner and name by: `{ owners, names }`. */
function aliases(source, sink, file) {
  const [owner, name] = sink.split("::");
  const module = owner === "lib" ? "crate" : owner;
  const owners = new Set([escape(module)]);
  const names = new Set(`${owner}.rs` === file ? [name] : []);
  for (const { segs, local, glob } of importsOf(source)) {
    const last = segs.at(-1);
    if (glob && last === module) names.add(name);
    else if (!glob && last === module) owners.add(escape(local));
    else if (!glob && last === name && segs.at(-2) === module) names.add(local);
  }
  const typeAlias = new RegExp(
    `\\btype\\s+(\\w+)(?:<[^>]*>)?\\s*=\\s*(?:[\\w:]*::)?${escape(owner)}\\b`,
    "g",
  );
  for (const m of source.matchAll(typeAlias)) owners.add(m[1]);
  if (TYPE_FILES[owner] === file) owners.add("Self");
  return { owners: [...owners], names: [...names].map(escape), name: escape(name) };
}

/** The patterns that find a sink's or a source's calls, and its uses as a value, in `file`. */
function sinkPatterns(source, file) {
  return [...SINKS, ...SOURCES]
    .map((sink) => {
      if (sink.startsWith(".")) return [sink, new RegExp(`\\.${escape(sink.slice(1))}\\s*\\(`)];
      const { owners, names, name } = aliases(source, sink, file);
      const paths = `(?:^|[^\\w])(?:${owners.join("|")})::${name}\\b`;
      const call = `${paths}\\s*\\(` + (names.length ? `|(?:^|[^\\w.:])(?:${names.join("|")})\\s*\\(` : "");
      const value = `${paths}(?!\\s*\\()` + (names.length ? `|[(,]\\s*(?:${names.join("|")})\\s*[),]` : "");
      return [sink, new RegExp(`${call}|${value}`)];
    })
    .concat([
      [
        PARSE,
        /\bfrom_(?:str|slice|reader|value)\s*::\s*<\s*(?:[\w:]*::)?CorpusConfig\s*>|:\s*(?:[\w:]*::)?CorpusConfig\s*=\s*serde_json::/,
      ],
    ]);
}

/** A line with string and char literals blanked and its comment removed. */
const bare = (line) =>
  line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)'/g, "' '")
    .replace(/\/\/.*$/, "");

/** The variables an expression names: no fields, methods, paths, types or keywords. */
const vars = (expr) =>
  new Set(
    [...expr.matchAll(/(?<![\w.:'])([a-z_]\w*)\b(?!\s*(?:\(|::|!))/g)]
      .map((m) => m[1])
      .filter((v) => v !== "_" && !KEYWORDS.has(v)),
  );

/** The block stack at `at`: the offsets of the braces still open there. */
function blocksAt(code, at) {
  const open = [];
  for (let i = 0; i < at; i += 1) {
    if (code[i] === "{") open.push(i);
    else if (code[i] === "}") open.pop();
  }
  return open;
}
const encloses = (outer, inner) => outer.length <= inner.length && outer.every((b, i) => inner[i] === b);
const same = (a, b) => a.length === b.length && encloses(a, b);

/** From `(` at `open`, the offset just past its matching `)`. */
function closing(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if ("([{".includes(code[i])) depth += 1;
    else if (")]}".includes(code[i]) && --depth === 0) return i + 1;
  }
  return code.length;
}

/** Every `let`, `if let`, `while let` and `for` binding: `{ start, from, to, names }` (`from..to` is its value). */
function bindings(code) {
  const out = [];
  for (const m of code.matchAll(/\b(let|for)\s+/g)) {
    const pattern = m.index + m[0].length;
    let depth = 0;
    let from = -1;
    for (let i = pattern; i < code.length; i += 1) {
      if ("([{".includes(code[i])) depth += 1;
      else if (")]}".includes(code[i])) depth -= 1;
      else if (
        depth === 0 &&
        m[1] === "let" &&
        code[i] === "=" &&
        !/[=!<>]/.test(code[i - 1]) &&
        !/[=>]/.test(code[i + 1])
      ) {
        from = i + 1;
        break;
      } else if (depth === 0 && m[1] === "for" && code.startsWith(" in ", i)) {
        from = i + 4;
        break;
      }
      if (depth < 0) break;
    }
    if (from < 0) continue;
    const opens = m[1] === "for" || /\b(?:if|while)\s*$|&&\s*$/.test(code.slice(0, m.index));
    let to = from;
    for (depth = 0; to < code.length; to += 1) {
      if (depth === 0 && (code[to] === ";" || (opens && code[to] === "{"))) break;
      if ("([{".includes(code[to])) depth += 1;
      else if (")]}".includes(code[to]) && --depth < 0) break;
    }
    const names = vars(code.slice(pattern, from).replace(/:[^,)=]*$/, ""));
    out.push({ start: m.index, from, to, names });
  }
  return out;
}

/** `seeds` and every variable a later `let` in `code` binds from one of them. */
function taint(code, lets, seeds, after) {
  const out = new Set(seeds);
  for (const b of lets)
    if (b.start >= after && [...vars(code.slice(b.from, b.to))].some((v) => out.has(v)))
      for (const n of b.names) out.add(n);
  return out;
}

/** Whether a guard (`pattern`) in `code` covers the marked call at `at`..`end`. */
function guarded(code, pattern, at, end, source) {
  const lets = bindings(code);
  const guards = [...code.matchAll(pattern)].map((m) => {
    const open = m.index + m[0].length - 1;
    return { at: m.index, end: closing(code, open), args: code.slice(open, closing(code, open)) };
  });
  if (source && guards.some((g) => g.at < at && g.end >= end)) return true;
  const callBlocks = blocksAt(code, at);
  if (!source) {
    const args = vars(code.slice(at, end));
    return guards.some((g) => {
      if (g.end > at || !encloses(blocksAt(code, g.at), callBlocks)) return false;
      const bound = lets.find((b) => b.from <= g.at && g.end <= b.to)?.names ?? [];
      const reach = taint(code, lets, [...vars(g.args), ...bound], g.end);
      return [...args].some((v) => reach.has(v));
    });
  }
  const read = lets.filter((b) => b.from <= at && end <= b.to).at(-1);
  if (!read) return false;
  const home = blocksAt(code, read.start);
  const reach = taint(code, lets, read.names, read.to);
  return guards.some(
    (g) => g.at > at && same(blocksAt(code, g.at), home) && [...vars(g.args)].some((v) => reach.has(v)),
  );
}

/** Binding calls in one file: `{ line, text, sink, fn, category, problem }`. */
export function bindCalls(source, file) {
  const patterns = sinkPatterns(source, file);
  const lines = productionLines(source);
  const starts = lines.flatMap((text, index) => (FN.test(text) ? [index] : []));
  const found = [];
  let fnName = null;
  let fnStart = 0;
  let fnEnd = lines.length;
  lines.forEach((text, index) => {
    const fn = FN.exec(text);
    if (fn) {
      fnName = fn[1];
      fnStart = index;
      fnEnd = starts.find((start) => start > index) ?? lines.length;
      return;
    }
    const call = bare(text);
    const hit = patterns.map(([sink, pattern]) => [sink, pattern.exec(call)]).find(([, m]) => m);
    if (!hit || /^\s*use\s/.test(call)) return;
    const [sink, match] = hit;
    let above = index;
    while (above > 0 && lines[above - 1].trim().startsWith("//")) above -= 1;
    const category = MARKER.exec(lines.slice(above, index + 1).join("\n"))?.[1] ?? null;
    let problem = null;
    const isSource = SOURCES.includes(sink) || sink === PARSE;
    const covered = (pattern) => {
      const body = lines.slice(fnStart, fnEnd).map(bare);
      const code = body.join("\n");
      const at = body.slice(0, index - fnStart).join("\n").length + (index > fnStart ? 1 : 0) + match.index;
      const paren = code.indexOf("(", at + match[0].trimEnd().length - 1);
      const end = paren >= 0 && paren <= at + match[0].length ? closing(code, paren) : at + match[0].length;
      return guarded(code, new RegExp(pattern.source, "g"), at, end, isSource);
    };
    if (category === "refused" && !covered(REFUSALS))
      problem = `marked refused, but nothing in fn ${fnName} refuses ${isSource ? "the path it reads, in the read's own block" : "this call's path before it, in a block that encloses it"}`;
    if (category === "live" && !covered(LIVE))
      problem = `marked live, but fn ${fnName} takes no root through host_registry::live_* from ${isSource ? "what it reads, in the read's own block" : "this call's path, in a block that encloses it"}`;
    if (category === "delegated" && !sinkNames.has(fnName))
      problem = `marked delegated, but fn ${fnName} is not in scripts/check-vault-binds.mjs SINKS or SOURCES`;
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
          `${at}: ${call.sink}(…) in fn ${call.fn} binds a root or reads the registry without saying why that is safe under a host ID; refuse the path first (reject_privileged_root / refuse_existing_vault) and mark it \`// vault bind (<category>): <reason>\` (categories: ${Object.keys(CATEGORIES).join(", ")})`,
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
    `check:vault-binds ok — every root bind and registry read says why it is safe under a host ID; ${total} sites in ${Object.keys(allowlist).length} files`,
  );
}
