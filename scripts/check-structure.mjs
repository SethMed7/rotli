import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { SYNTAX_PATTERNS } from "./syntax-contract.mjs";

const root = process.cwd();
const violations = [];
const ignoredDirectories = new Set(["node_modules", "target", "dist", "build"]);

// ── filename law, per tree ───────────────────────────────────────────────────
// One convention per tree, mechanically held (measured 2026-07-18):
//   src/                     camelCase   (the app's long-standing rule)
//   scripts/, e2e/, docs/,   kebab-case  (the dominant convention in each —
//   breve-runtime/           the breve tree was 29 kebab vs 6 camelCase; the
//                            6 outliers were renamed rather than grandfathered)
// The stem is everything before the first dot, so `check-code-shape.test.ts`
// and `memex-write-contract-v3.5-proposal.md` both judge their kebab stem.
const CAMEL = SYNTAX_PATTERNS.camelCase;
const KEBAB = SYNTAX_PATTERNS.kebabCase;
const SNAKE = SYNTAX_PATTERNS.snakeCase;

function walkNames(dir, extensions, pattern, label, exemptNames = new Set()) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkNames(path, extensions, pattern, label, exemptNames);
    else if (extensions.test(name) && !exemptNames.has(name)) {
      const stem = basename(name).split(".")[0];
      if (!pattern.test(stem)) violations.push(`${relative(root, path)}: filenames here must be ${label}`);
    }
  }
}

function walkDirectories(dir, pattern, label) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (ignoredDirectories.has(name)) continue;
    if (!name.startsWith(".") && !pattern.test(name)) {
      violations.push(`${relative(root, path)}: folders here must be ${label}`);
    }
    walkDirectories(path, pattern, label);
  }
}

walkNames(join(root, "src"), /\.(ts|tsx)$/, CAMEL, "camelCase", new Set(["vite-env.d.ts"])); // Vite's conventional generated declaration
walkNames(join(root, "scripts"), /\.(mjs|sh|ts|json|md)$/, KEBAB, "kebab-case");
walkNames(join(root, "e2e"), /\.ts$/, KEBAB, "kebab-case");
walkNames(join(root, "breve-runtime/scripts"), /\.(ts|sh)$/, KEBAB, "kebab-case");
walkNames(join(root, "breve-runtime/tests"), /\.(ts|sh)$/, KEBAB, "kebab-case");
walkNames(join(root, "docs"), /\.md$/, KEBAB, "kebab-case", new Set(["README.md"])); // GitHub's own convention
walkDirectories(join(root, "src"), CAMEL, "camelCase");
walkDirectories(join(root, "scripts"), KEBAB, "kebab-case");
walkDirectories(join(root, "e2e"), KEBAB, "kebab-case");
walkDirectories(join(root, "docs"), KEBAB, "kebab-case");
walkDirectories(join(root, "breve-runtime"), KEBAB, "kebab-case");
walkNames(join(root, "src-tauri/src"), /\.rs$/, SNAKE, "snake_case");
walkDirectories(join(root, "src-tauri/src"), SNAKE, "snake_case");

// ── tsconfig strictness parity ───────────────────────────────────────────────
// Three compilers typecheck this repo (root src, e2e, breve-runtime). Load-
// bearing strictness must not drift silently between them: every flag below is
// either true in a config or that config carries a dated divergence entry with
// the measured adoption cost. A divergence entry for a flag that is now enabled
// is stale and fails too.
const REQUIRED_STRICT_FLAGS = [
  "strict",
  "exactOptionalPropertyTypes",
  "noUnusedLocals",
  "noUnusedParameters",
  "noFallthroughCasesInSwitch",
  "noUncheckedIndexedAccess",
];
const TSCONFIG_FILES = ["tsconfig.json", "tsconfig.e2e.json", "breve-runtime/tsconfig.json"];
// Documented divergences — measured with a probe config (tsc --noEmit), not vibes.
// Re-measure before removing an entry; remove the entry in the same change that
// turns the flag on.
const TSCONFIG_DIVERGENCES = {
  "breve-runtime/tsconfig.json": {
    exactOptionalPropertyTypes: "11 errors (scheduler JobState + daemon spawn options; measured 2026-07-18) — semantic fixes in the delivery hot path, deferred",
    noUnusedLocals: "9 errors (measured 2026-07-18) — deletions touch live daemon files, deferred to a quiet boundary",
    noUnusedParameters: "3 errors (measured 2026-07-18) — same batch as noUnusedLocals",
    noUncheckedIndexedAccess: "86 errors (measured 2026-07-18) — far over the 15-site adoption threshold; revisit with the breve-runtime any-debt",
  },
};
const stripJsonComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const rel of TSCONFIG_FILES) {
  const options = JSON.parse(stripJsonComments(readFileSync(join(root, rel), "utf8"))).compilerOptions ?? {};
  const divergences = TSCONFIG_DIVERGENCES[rel] ?? {};
  for (const flag of REQUIRED_STRICT_FLAGS) {
    if (options[flag] === true && flag in divergences) {
      violations.push(`${rel}: stale divergence entry — ${flag} is enabled; delete it from TSCONFIG_DIVERGENCES`);
    } else if (options[flag] !== true && !(flag in divergences)) {
      violations.push(`${rel}: ${flag} is not enabled and has no divergence entry in check-structure.mjs`);
    }
  }
  for (const flag of Object.keys(divergences)) {
    if (!REQUIRED_STRICT_FLAGS.includes(flag)) violations.push(`${rel}: divergence entry for unknown flag ${flag}`);
  }
}

const deniedDependencies = [
  "better-sqlite3",
  "dexie",
  "diesel",
  "pouchdb",
  "prisma",
  "rusqlite",
  "sqlx",
  "sqlite",
  "sqlite3",
];
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const jsDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
for (const dependency of deniedDependencies) {
  if (dependency in jsDependencies) violations.push(`package.json: database dependency ${dependency}`);
}

// Removed 2026-07 for CVE-2023-30533 + npm abandonment — exceljs owns every
// spreadsheet path. Never let it creep back.
if ("xlsx" in jsDependencies) {
  violations.push("package.json: xlsx (SheetJS) is banned — use the exceljs codec (src/sheets/codec)");
}

// Breve is bundled from its own runtime package, while the root install supplies
// those modules during development/build. Overlapping dependencies must stay on
// the exact same range so dev validation cannot pass against a different API
// than the packaged runtime installs.
const brevePackage = JSON.parse(readFileSync(join(root, "breve-runtime/defaults/package.json"), "utf8"));
for (const [dependency, version] of Object.entries(brevePackage.dependencies ?? {})) {
  if (packageJson.dependencies?.[dependency] !== version) {
    violations.push(
      `Breve dependency ${dependency} must match: root=${packageJson.dependencies?.[dependency] ?? "missing"}, runtime=${version}`,
    );
  }
}

const blockRender = readFileSync(join(root, "src/editor/blockRender.ts"), "utf8");
if (!/jc:\s*\{\s*compile:\s*false\s*\}/.test(blockRender)) {
  violations.push("JSXGraph JessieCode must stay in interpreter mode; production CSP forbids unsafe-eval");
}
const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
for (const dependency of deniedDependencies) {
  if (new RegExp(`^${dependency}\\s*=`, "m").test(cargo)) {
    violations.push(`src-tauri/Cargo.toml: database dependency ${dependency}`);
  }
}

if (violations.length) {
  console.error(`structure check failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(
  "check:structure ok — per-tree file/folder naming, tsconfig strictness parity, no database, Breve dependency ranges aligned",
);
