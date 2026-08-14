// Duplication miner — deterministic, AI-free (remediation Batch 6a). Mines the
// three code roots for near-duplicate implementation clusters and emits a
// suspects report. NEVER part of the `lint` chain and never blocking: cadence is
// manual + weekly (`bun run check:dup`), with `--diff` scoped to `git diff main`
// files for non-blocking CI report artifacts (Stage 5 wires that). The opt-in
// model judge (`bun run check:dup --judge`) sends ONLY mined suspects to
// `claude -p --model haiku` from a scratch cwd (no CLAUDE.md/CARL bleed) and
// caches verdicts in scripts/dup-judgments.json keyed by
// sha256(normalized-snippets + PROMPT_VERSION + model-name).
//
// Signals (a cluster needs >= 1):
//   1. shingle   — within-language only: k=25 normalized-token shingles,
//                  winnowed fingerprints, Jaccard >= 0.70
//   2. literal   — the cross-language signal: >= 2 shared literals each
//                  appearing <= 4 times repo-wide (byte caps, paths, keychain
//                  accounts, event names — exact match, no folding)
//   3. lifecycle — co-occurring add/removeEventListener, pointerdown/move/up/
//                  cancel, spawn/kill, open/close, timer set/clear pairs with
//                  matching member sequences
// Normalization: comments/whitespace stripped, local identifiers -> $ID;
// property/API names, string/number literals, and control keywords kept.
// Tests are down-ranked x0.5, not excluded.
//
// One-time history validation (pinned; NOT a persistent test — a persistent
// test cannot check out an old SHA): run 2026-07-17 against the pre-Batch-3
// tree at d40073a (`git worktree add <tmp> d40073a && cd <tmp> && bun <this
// file>`), the miner rediscovered the clusters Batches 3/4 fixed:
//   F4  — exactly: lifecycle-677e17ed8b (mainAddDrag.ts:46-118 +
//         tabDrag.ts:42-180), lifecycle-d32c0e17e7 (boardSurface.tsx +
//         sidebar.tsx:713-791), lifecycle-411d98885d (the teardown block
//         across all four drag files)
//   F20a — exactly: shingle-8d57c1053b (cmEditor.tsx clamp pair),
//         shingle-d8be1e971f (panes.ts clamp pair)
//   F12 — indirectly: the sidebar/tabStrip rare-literal bundle plus sidebar
//         row-handler shingle pairs; the rename <input> JSX itself lives
//         inside larger components, below unit granularity
//   F14/F15 — NOT rediscovered, by design: one-line ext expressions and
//         6-line intra-function fragments sit under the >= 30-token
//         function-level floor. Fragment-level mining is a deliberate
//         non-goal (noise dominates below the floor).
//
// Allowlist: scripts/dup-allowlist.json — entries match by exact cluster
// fingerprint, or by a files list (every site of the cluster must live in the
// listed files) for decisions that must survive edits, e.g. the organizer.rs-
// vs-Breve retry divergence (synthesis: "do not fix", permanent).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// TypeScript 7's default package export is the CLI/version shim and no longer
// exposes the stable compiler API this miner needs. The repository pins the
// compatibility compiler explicitly for AST-based tooling.
import ts from "typescript6";

const root = process.cwd();
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const MIN_UNIT_TOKENS = 30;
const SHINGLE_K = 25;
const WINNOW_W = 4;
const JACCARD_MIN = 0.7;
const RARE_LITERAL_MAX_OCCURRENCES = 4;
const SHARED_LITERAL_MIN = 2;
const LIFECYCLE_MIN_SEQUENCE = 4;
const TOP_CLUSTERS = 25;
const EXCERPT_MAX_LINES = 40;
const JUDGE_MODEL = "haiku";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "target", "gen", ".git"]);
const SCAN_ROOTS = [
  { dir: "src", exts: [".ts", ".tsx"], lang: "ts" },
  { dir: "breve-runtime/scripts", exts: [".ts"], lang: "ts" },
  { dir: "src-tauri/src", exts: [".rs"], lang: "rust" },
];

// Control keywords survive normalization (both languages, one set — shingles
// only ever compare within-language, so overlap is harmless).
const KEYWORDS = new Set([
  "if",
  "else",
  "for",
  "while",
  "do",
  "return",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "try",
  "catch",
  "finally",
  "throw",
  "new",
  "typeof",
  "instanceof",
  "in",
  "of",
  "void",
  "delete",
  "function",
  "class",
  "extends",
  "super",
  "this",
  "const",
  "let",
  "var",
  "async",
  "await",
  "yield",
  "import",
  "export",
  "from",
  "as",
  "interface",
  "type",
  "enum",
  "namespace",
  "readonly",
  "static",
  "public",
  "private",
  "protected",
  "abstract",
  "true",
  "false",
  "null",
  "undefined",
  "never",
  "unknown",
  "any",
  "string",
  "number",
  "boolean",
  "object",
  "symbol",
  "bigint",
  "keyof",
  "infer",
  "satisfies",
  "is",
  "fn",
  "pub",
  "mut",
  "impl",
  "struct",
  "trait",
  "mod",
  "use",
  "crate",
  "self",
  "Self",
  "match",
  "loop",
  "ref",
  "move",
  "dyn",
  "where",
  "unsafe",
  "extern",
  "Some",
  "None",
  "Ok",
  "Err",
  "Box",
  "Vec",
  "String",
  "Option",
  "Result",
  "u8",
  "u16",
  "u32",
  "u64",
  "usize",
  "i8",
  "i16",
  "i32",
  "i64",
  "isize",
  "f32",
  "f64",
  "str",
  "bool",
  "char",
]);

// Bare global API calls that carry signal (property accesses are kept by the
// after-dot rule; these appear without a receiver).
const KNOWN_GLOBALS = new Set([
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "fetch",
  "structuredClone",
  "queueMicrotask",
  "console",
  "window",
  "document",
  "navigator",
  "JSON",
  "Math",
  "Promise",
  "Object",
  "Array",
  "Date",
  "Map",
  "Set",
  "addEventListener",
  "removeEventListener",
]);

const LIFECYCLE_EVENTS = new Set([
  "addEventListener",
  "removeEventListener",
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "spawn",
  "kill",
  "open",
  "close",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
]);

// ---------------------------------------------------------------------------
// Tokenizer — one scanner for both languages; language only changes string and
// comment forms (nested block comments, raw strings, lifetimes in Rust).

function tokenize(src, lang) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (lang === "rust" && src[i] === "/" && src[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (lang === "rust" && (c === "r" || c === "b")) {
      const m = /^b?r(#*)"/.exec(src.slice(i, i + 8));
      if (m) {
        const open = i + src.slice(i, i + 8).indexOf('"') + 1;
        const close = '"' + m[1];
        const end = src.indexOf(close, open);
        toks.push({ kind: "str", value: src.slice(open, end < 0 ? n : end) });
        i = end < 0 ? n : end + close.length;
        continue;
      }
    }
    if (c === '"' || c === "'" || (c === "`" && lang !== "rust")) {
      if (c === "'" && lang === "rust") {
        const m = /^'(?:\\.|[^'\\])'/.exec(src.slice(i, i + 8));
        if (m) {
          toks.push({ kind: "str", value: m[0].slice(1, -1) });
          i += m[0].length;
          continue;
        }
        toks.push({ kind: "punct", text: "'" });
        i++;
        continue; // lifetime tick
      }
      const quote = c;
      let j = i + 1;
      let val = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") {
          val += src[j] + (src[j + 1] ?? "");
          j += 2;
        } else {
          val += src[j];
          j++;
        }
      }
      toks.push({ kind: "str", value: val });
      i = j + 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n) {
        const d = src[j];
        if (/[0-9a-fA-F_xXoObBeE]/.test(d)) {
          j++;
          continue;
        }
        if (d === "." && /[0-9]/.test(src[j + 1] ?? "")) {
          j += 2;
          continue;
        }
        break;
      }
      while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++; // numeric suffixes (usize, f64, n)
      toks.push({ kind: "num", text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      toks.push({ kind: "ident", text: src.slice(i, j) });
      i = j;
      continue;
    }
    toks.push({ kind: "punct", text: c });
    i++;
  }
  return toks;
}

function normalizeTokens(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === "ident") {
      const prev = toks[i - 1];
      const prev2 = toks[i - 2];
      const afterDot = prev?.kind === "punct" && prev.text === ".";
      const afterPath = prev?.text === ":" && prev2?.text === ":";
      out.push(KEYWORDS.has(t.text) || KNOWN_GLOBALS.has(t.text) || afterDot || afterPath ? t.text : "$ID");
    } else if (t.kind === "str") out.push(JSON.stringify(t.value));
    else if (t.kind === "num") out.push(t.text.replace(/_/g, ""));
    else out.push(t.text);
  }
  return out;
}

function literalsOf(toks) {
  const out = [];
  for (const t of toks) {
    if (t.kind === "str" && t.value.length >= 3) out.push(`s:${t.value}`);
    else if (t.kind === "num") {
      const v = t.text.replace(/_/g, "");
      if (!["0", "1", "2"].includes(v) && v.length >= 3) out.push(`n:${v}`);
    }
  }
  return out;
}

function lifecycleSequence(toks) {
  const seq = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const name = t.kind === "str" ? t.value : t.kind === "ident" ? t.text : null;
    if (name && LIFECYCLE_EVENTS.has(name)) seq.push(name);
  }
  return seq;
}

// ---------------------------------------------------------------------------
// File walking + unit extraction

function walk(dir, exts, out) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const name of readdirSync(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(abs, name);
    if (statSync(path).isDirectory()) walk(join(dir, name), exts, out);
    else if (exts.some((e) => name.endsWith(e)) && !name.endsWith(".d.ts")) out.push(relative(root, path));
  }
}

function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}

function isTestPath(rel) {
  return /\.test\.(ts|tsx)$|(^|\/)tests?\//.test(rel) || /_tests?\.rs$/.test(rel);
}

function extractTsUnits(rel, text) {
  const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const units = [];
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessor(node) ||
        ts.isSetAccessor(node)) &&
      node.body
    ) {
      let name = node.name?.getText(sf);
      if (!name && ts.isVariableDeclaration(node.parent)) name = node.parent.name.getText(sf);
      if (!name && ts.isPropertyAssignment(node.parent)) name = node.parent.name.getText(sf);
      units.push({ start: node.getStart(sf), end: node.end, name: name ?? "<anon>" });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return units;
}

function extractRustUnits(rel, text) {
  const units = [];
  const re =
    /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:const[ \t]+|async[ \t]+|unsafe[ \t]+|extern[ \t]+"[^"]*"[ \t]+)*fn[ \t]+([A-Za-z_][A-Za-z0-9_]*)/gm;
  let m;
  while ((m = re.exec(text))) {
    const braceStart = findBodyBrace(text, m.index + m[0].length);
    if (braceStart < 0) continue;
    const end = balanceBraces(text, braceStart);
    if (end < 0) continue;
    units.push({ start: m.index + (m[0].length - m[0].trimStart().length), end, name: m[1] });
    re.lastIndex = braceStart + 1; // nested fns get their own match
  }
  return units;
}

function findBodyBrace(text, from) {
  // Walk past the signature (generics/args/return type/where) to the body `{`;
  // angle brackets and parens can nest, `{` at depth 0 opens the body.
  let depth = 0;
  for (let i = from; i < Math.min(text.length, from + 2000); i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === ">") depth = Math.max(0, depth - 1);
    else if (c === "{" && depth === 0) return i;
    else if (c === ";" && depth === 0) return -1; // trait/extern decl, no body
  }
  return -1;
}

function balanceBraces(text, open) {
  let depth = 0;
  let i = open;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      let d = 1;
      i += 2;
      while (i < n && d > 0) {
        if (text[i] === "/" && text[i + 1] === "*") {
          d++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          d--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "'") {
      const m = /^'(?:\\.|[^'\\])'/.exec(text.slice(i, i + 8));
      i += m ? m[0].length : 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Signals

function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function winnow(tokens) {
  if (tokens.length < SHINGLE_K) return new Set();
  const hashes = [];
  for (let i = 0; i + SHINGLE_K <= tokens.length; i++)
    hashes.push(fnv(tokens.slice(i, i + SHINGLE_K).join("\x1f")));
  const picked = new Set();
  if (hashes.length <= WINNOW_W) {
    for (const h of hashes) picked.add(h);
    return picked;
  }
  for (let i = 0; i + WINNOW_W <= hashes.length; i++) {
    let min = Infinity;
    for (let j = i; j < i + WINNOW_W; j++) if (hashes[j] < min) min = hashes[j];
    picked.add(min);
  }
  return picked;
}

function jaccard(a, b) {
  let inter = 0;
  for (const h of a) if (b.has(h)) inter++;
  return inter / (a.size + b.size - inter);
}

class UnionFind {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a, b) {
    this.p[this.find(a)] = this.find(b);
  }
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Mining

function mine() {
  const files = [];
  for (const { dir, exts, lang } of SCAN_ROOTS) {
    const found = [];
    walk(dir, exts, found);
    for (const rel of found.sort((a, b) => a.localeCompare(b))) files.push({ rel, lang });
  }

  const units = [];
  const literalCensus = new Map(); // literal -> repo-wide occurrence count (full file text)
  for (const { rel, lang } of files) {
    const text = readFileSync(join(root, rel), "utf8");
    const fileToks = tokenize(text, lang);
    for (const lit of literalsOf(fileToks)) literalCensus.set(lit, (literalCensus.get(lit) ?? 0) + 1);

    const raw = lang === "ts" ? extractTsUnits(rel, text) : extractRustUnits(rel, text);
    const cfgTest = lang === "rust" ? text.indexOf("#[cfg(test)]") : -1;
    const seen = new Set(); // wrapper patterns can yield one span twice (e.g. memo(fn))
    for (const u of raw) {
      const span = `${u.start}:${u.end}`;
      if (seen.has(span)) continue;
      seen.add(span);
      const src = text.slice(u.start, u.end);
      const toks = tokenize(src, lang);
      const norm = normalizeTokens(toks);
      if (norm.length < MIN_UNIT_TOKENS) continue;
      units.push({
        file: rel,
        lang,
        name: u.name,
        startLine: lineOf(text, u.start),
        endLine: lineOf(text, u.end - 1),
        src,
        norm,
        prints: winnow(norm),
        literals: new Set(literalsOf(toks)),
        lifecycle: lifecycleSequence(toks),
        isTest: isTestPath(rel) || (cfgTest >= 0 && u.start >= cfgTest),
      });
    }
  }

  const clusters = [];

  // Signal 1: winnowed shingle similarity, within-language only.
  {
    const index = new Map();
    units.forEach((u, i) => {
      for (const h of u.prints) (index.get(h) ?? index.set(h, []).get(h)).push(i);
    });
    const pairCounts = new Map();
    for (const members of index.values()) {
      if (members.length < 2 || members.length > 64) continue; // >64 = boilerplate fingerprint
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          if (units[members[a]].lang !== units[members[b]].lang) continue;
          const key = members[a] * 1e6 + members[b];
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
      }
    }
    const uf = new UnionFind(units.length);
    const pairJaccard = new Map();
    for (const [key, count] of pairCounts) {
      if (count < 2) continue;
      const a = Math.floor(key / 1e6);
      const b = key % 1e6;
      const j = jaccard(units[a].prints, units[b].prints);
      if (j >= JACCARD_MIN) {
        uf.union(a, b);
        pairJaccard.set(key, j);
      }
    }
    const groups = new Map();
    for (const key of pairJaccard.keys()) {
      const a = Math.floor(key / 1e6);
      const roothash = uf.find(a);
      (groups.get(roothash) ?? groups.set(roothash, new Set()).get(roothash)).add(a).add(key % 1e6);
    }
    for (const members of groups.values()) {
      const sites = [...members].map((i) => units[i]);
      let minJ = 1;
      for (const [key, j] of pairJaccard) {
        if (members.has(Math.floor(key / 1e6)) && members.has(key % 1e6)) minJ = Math.min(minJ, j);
      }
      const minTokens = Math.min(...sites.map((u) => u.norm.length));
      clusters.push(buildCluster("shingle", sites, Math.round(minJ * minTokens), []));
    }
  }

  // Signal 2: rare-literal bundle (the cross-language signal).
  {
    const rareByUnit = units.map((u) =>
      [...u.literals].filter((l) => (literalCensus.get(l) ?? 0) <= RARE_LITERAL_MAX_OCCURRENCES),
    );
    const index = new Map();
    rareByUnit.forEach((lits, i) => {
      for (const l of lits) (index.get(l) ?? index.set(l, []).get(l)).push(i);
    });
    const pairShared = new Map();
    for (const members of index.values()) {
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          const key = members[a] * 1e6 + members[b];
          pairShared.set(key, (pairShared.get(key) ?? 0) + 1);
        }
      }
    }
    // Group by the EXACT shared-literal set (no transitive union-find — literal
    // chains through unrelated units otherwise) and only across files: same-file
    // literal reuse is a const-extraction nit, not a mirror-drift suspect.
    const byLitSet = new Map();
    for (const [key, shared] of pairShared) {
      if (shared < SHARED_LITERAL_MIN) continue;
      const a = Math.floor(key / 1e6);
      const b = key % 1e6;
      if (units[a].file === units[b].file) continue;
      const lits = rareByUnit[a].filter((l) => units[b].literals.has(l)).sort();
      const setKey = lits.join("\x1f");
      (byLitSet.get(setKey) ?? byLitSet.set(setKey, new Set()).get(setKey)).add(a).add(b);
    }
    for (const [setKey, members] of byLitSet) {
      const sites = [...members].map((i) => units[i]);
      const lits = setKey.split("\x1f");
      clusters.push(
        buildCluster(
          "literal",
          sites,
          12 * lits.length,
          lits.map((l) => l.slice(2)),
        ),
      );
    }
  }

  // Signal 3: lifecycle bundles with matching member sequences.
  {
    const bySeq = new Map();
    units.forEach((u, i) => {
      if (u.lifecycle.length < LIFECYCLE_MIN_SEQUENCE) return;
      if (new Set(u.lifecycle).size < 2) return;
      const key = u.lifecycle.join(">");
      (bySeq.get(key) ?? bySeq.set(key, []).get(key)).push(i);
    });
    for (const [seq, members] of bySeq) {
      if (members.length < 2) continue;
      const sites = members.map((i) => units[i]);
      clusters.push(buildCluster("lifecycle", sites, 10 * seq.split(">").length, []));
    }
  }

  // Drop clusters wholly contained in a bigger same-signal cluster (nested
  // arrow inside an already-flagged function), then dedupe identical site sets
  // across signals (highest score wins).
  const real = clusters.filter(Boolean);
  const surviving = real.filter((c) => !real.some((other) => other !== c && contains(other, c)));
  const bySites = new Map();
  for (const c of surviving) {
    const key = c.sites.map((s) => `${s.file}:${s.lines}`).join("|");
    const prev = bySites.get(key);
    if (!prev || c.score > prev.score) bySites.set(key, c);
  }
  return { files, units, clusters: [...bySites.values()] };
}

function contains(outer, inner) {
  if (outer.signal !== inner.signal || outer.sites.length < inner.sites.length) return false;
  return inner.sites.every((s) =>
    outer.sites.some(
      (o) =>
        o.file === s.file &&
        o.startLine <= s.startLine &&
        o.endLine >= s.endLine &&
        (o.startLine !== s.startLine || o.endLine !== s.endLine),
    ),
  );
}

function buildCluster(signal, sites, baseScore, sharedLiterals) {
  // Keep only outermost sites: a unit clustering with its own enclosing
  // function is self-similarity through nesting, not duplication.
  sites = sites.filter(
    (u) =>
      !sites.some(
        (o) =>
          o !== u &&
          o.file === u.file &&
          o.startLine <= u.startLine &&
          o.endLine >= u.endLine &&
          (o.startLine !== u.startLine || o.endLine !== u.endLine || sites.indexOf(o) < sites.indexOf(u)),
      ),
  );
  if (sites.length < 2) return null;
  const anyTest = sites.some((u) => u.isTest);
  const ordered = [...sites].sort((a, b) =>
    a.file === b.file ? a.startLine - b.startLine : a.file < b.file ? -1 : 1,
  );
  const fingerprint = sha256(
    signal +
      "\n" +
      ordered
        .map((u) => u.norm.join("\x1f"))
        .sort((a, b) => a.localeCompare(b))
        .join("\n\x00"),
  );
  return {
    id: `${signal}-${fingerprint.slice(0, 10)}`,
    score: Math.round(baseScore * (anyTest ? 0.5 : 1)),
    signal,
    fingerprint,
    sharedLiterals,
    normalizedSnippets: ordered.map((u) => u.norm.join(" ")),
    sites: ordered.map((u) => ({
      file: u.file,
      name: u.name,
      lines: `${u.startLine}-${u.endLine}`,
      startLine: u.startLine,
      endLine: u.endLine,
      excerpt: u.src.split("\n").slice(0, EXCERPT_MAX_LINES).join("\n"),
    })),
  };
}

// ---------------------------------------------------------------------------
// Allowlist + report

function loadAllowlist() {
  const path = join(root, "scripts/dup-allowlist.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")).entries ?? [];
}

function allowlisted(cluster, entries) {
  for (const e of entries) {
    if (e.fingerprint && e.fingerprint === cluster.fingerprint) return e;
    if (
      e.files &&
      (!e.signal || e.signal === cluster.signal) &&
      cluster.sites.every((s) => e.files.includes(s.file))
    )
      return e;
  }
  return null;
}

function changedFiles() {
  const res = spawnSync("git", ["diff", "--name-only", "main"], { cwd: root, encoding: "utf8" });
  if (res.status !== 0) {
    console.error("--diff: `git diff --name-only main` failed; is `main` available?");
    process.exit(1);
  }
  return new Set(res.stdout.split("\n").filter(Boolean));
}

// ---------------------------------------------------------------------------
// Judge (Batch 6b) — opt-in, cached, isolated. Never a gate.

function runJudge(clusters, limit) {
  const promptPath = join(root, "scripts/dup-judge-prompt.md");
  const prompt = readFileSync(promptPath, "utf8");
  const version = /PROMPT_VERSION:\s*(\S+)/.exec(prompt)?.[1];
  if (!version) {
    console.error("dup-judge-prompt.md must declare PROMPT_VERSION");
    process.exit(1);
  }
  const cachePath = join(root, "scripts/dup-judgments.json");
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  let calls = 0;
  let hits = 0;
  let failures = 0;
  const judged = [];
  for (const cluster of clusters.slice(0, limit ?? clusters.length)) {
    const key = sha256(cluster.normalizedSnippets.join("\n\x00") + "\n" + version + "\n" + JUDGE_MODEL);
    if (cache[key]) {
      hits++;
      judged.push({ cluster: cluster.id, cached: true, ...cache[key].judgment });
      continue;
    }
    const payload = {
      signal: cluster.signal,
      sharedLiterals: cluster.sharedLiterals,
      sites: cluster.sites.map((s) => ({ file: s.file, name: s.name, lines: s.lines, excerpt: s.excerpt })),
    };
    // Scratch cwd: claude must not load this repo's CLAUDE.md/CARL context —
    // the classification is schema-constrained and must stay instruction-clean.
    const scratch = mkdtempSync(join(tmpdir(), "dup-judge-"));
    let judgment = null;
    try {
      const res = spawnSync("claude", ["-p", "--model", JUDGE_MODEL], {
        input: `${prompt}\n\n## Cluster under judgment\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`,
        cwd: scratch,
        encoding: "utf8",
        timeout: 180_000,
      });
      if (res.status === 0) judgment = parseJudgment(res.stdout);
      if (!judgment) {
        failures++;
        console.error(`judge: invalid or failed response for ${cluster.id} (not cached)`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    if (judgment) {
      calls++;
      cache[key] = {
        fingerprint: cluster.fingerprint,
        signal: cluster.signal,
        files: cluster.sites.map((s) => s.file),
        promptVersion: version,
        model: JUDGE_MODEL,
        judgment,
      };
      judged.push({ cluster: cluster.id, cached: false, ...judgment });
    }
  }
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(cachePath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(
    `judge: ${calls} model calls, ${hits} cache hits, ${failures} failures -> scripts/dup-judgments.json`,
  );
  for (const j of judged) {
    console.log(`  ${j.cluster} ${j.cached ? "(cached)" : ""}: ${j.classification} -> ${j.action}`);
  }
}

const CLASSIFICATIONS = new Set([
  "duplicated_policy",
  "shared_mechanism",
  "independent_security_enforcement",
  "coincidental",
  "uncertain",
]);
const ACTIONS = new Set([
  "shared_helper",
  "shared_fixture",
  "generated_contract",
  "parity_test",
  "leave_documented",
]);

function parseJudgment(stdout) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!CLASSIFICATIONS.has(parsed.classification) || !ACTIONS.has(parsed.action)) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// Main

const { files, units, clusters } = mine();
const entries = loadAllowlist();
const suppressed = [];
let reported = clusters.filter((c) => {
  const hit = allowlisted(c, entries);
  if (hit) suppressed.push({ allowlistId: hit.id, clusterId: c.id, fingerprint: c.fingerprint });
  return !hit;
});

if (flag("--diff")) {
  const changed = changedFiles();
  reported = reported.filter((c) => c.sites.some((s) => changed.has(s.file)));
}

reported.sort((a, b) => b.score - a.score || (a.fingerprint < b.fingerprint ? -1 : 1));
const capped = flag("--all") ? reported : reported.slice(0, TOP_CLUSTERS);

const report = {
  scope: SCAN_ROOTS.map((r) => r.dir),
  fileCount: files.length,
  unitCount: units.length,
  clusterCount: reported.length,
  suppressed: suppressed.sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : 1)),
  clusters: capped.map(({ normalizedSnippets: _normalizedSnippets, ...c }) => ({
    ...c,
    sites: c.sites.map(({ startLine: _startLine, endLine: _endLine, ...s }) => s),
  })),
};

const outPath = opt("--out") ?? join(tmpdir(), "rotli-dup-suspects.json");
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

console.log(
  `check:dup — ${files.length} files, ${units.length} units, ${reported.length} clusters` +
    ` (${suppressed.length} allowlisted)${flag("--diff") ? " [diff mode]" : ""} -> ${outPath}`,
);
for (const c of capped.slice(0, 10)) {
  console.log(
    `  [${String(c.score).padStart(4)}] ${c.id} ${c.sites.map((s) => `${s.file}:${s.lines}`).join(" | ")}`,
  );
}

if (flag("--judge")) runJudge(capped, opt("--judge-limit") ? Number(opt("--judge-limit")) : undefined);
