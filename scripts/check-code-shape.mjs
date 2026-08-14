import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
const violations = [];
const sourceRoots = ["src", "breve-runtime/scripts"];
const testRoots = ["src", "e2e", "breve-runtime/tests", "scripts"];
const sourceExtensions = [".ts", ".tsx", ".mjs"];

function walkFiles(relRoot, predicate) {
  const files = [];
  const start = join(root, relRoot);
  if (!existsSync(start)) return files;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (predicate(path)) files.push(relative(root, path));
    }
  };
  walk(start);
  return files;
}

const productionFiles = sourceRoots.flatMap((dir) => walkFiles(
  dir,
  (path) => sourceExtensions.includes(extname(path)) && !/\.(?:test|spec)\.[^.]+$/.test(path),
));
const testFiles = testRoots.flatMap((dir) => walkFiles(
  dir,
  (path) => /(?:\.(?:test|spec)|\/test-[^/]+)\.tsx?$/.test(path),
));

// Pane surfaces and modal dialogs have one home (docs/development/adding-things.md).
// Feature-owned surfaces are enumerated exceptions; extending this set requires a
// matching row in the adding-things contract table.
const surfaceHomeExceptions = new Set([
  "src/editor/editorSurface.tsx",
  "src/components/breve/breveSurface.tsx",
  "src/components/chat/chatSurface.tsx",
]);
for (const file of productionFiles) {
  if (!file.startsWith("src/") || !/(?:Surface|Dialog)\.tsx$/.test(file)) continue;
  if (surfaceHomeExceptions.has(file)) continue;
  if (dirname(file) !== "src/components") {
    violations.push(`${file}: pane surfaces and dialogs live in src/components/ (docs/development/adding-things.md)`);
  }
}

for (const file of [...productionFiles, ...testFiles]) {
  const source = readFileSync(join(root, file), "utf8");
  if (/\b(?:describe|test|it)\.(?:only|skip)\s*\(|\b(?:fdescribe|fit|xit|xdescribe)\s*\(/.test(source)) {
    violations.push(`${file}: focused or skipped tests are not allowed`);
  }
  if (/\/\/\s*@ts-(?:ignore|nocheck)\b|\/\*\s*@ts-(?:ignore|nocheck)\b/.test(source)) {
    violations.push(`${file}: @ts-ignore and @ts-nocheck hide type regressions`);
  }
}

const graph = new Map(productionFiles.map((file) => [file, []]));

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(root, dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : [
      ...sourceExtensions.map((extension) => `${base}${extension}`),
      ...sourceExtensions.map((extension) => join(base, `index${extension}`)),
    ];
  const found = candidates.find((path) => existsSync(path));
  return found ? relative(root, found) : null;
}

for (const file of productionFiles) {
  const source = readFileSync(join(root, file), "utf8");
  const imports = [
    ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ...source.matchAll(/import\s+(["'])([^"']+)\1/g),
  ].map((match) => match[2]);
  for (const specifier of imports) {
    if (/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)(?:\.|$)/.test(specifier)) {
      violations.push(`${file}: production code imports test code ${specifier}`);
      continue;
    }
    const dependency = resolveImport(file, specifier);
    if (dependency && graph.has(dependency)) graph.get(file).push(dependency);
  }
}

const index = new Map();
const lowLink = new Map();
const stack = [];
const onStack = new Set();
let nextIndex = 0;

function visit(file) {
  index.set(file, nextIndex);
  lowLink.set(file, nextIndex);
  nextIndex++;
  stack.push(file);
  onStack.add(file);

  for (const dependency of graph.get(file)) {
    if (!index.has(dependency)) {
      visit(dependency);
      lowLink.set(file, Math.min(lowLink.get(file), lowLink.get(dependency)));
    } else if (onStack.has(dependency)) {
      lowLink.set(file, Math.min(lowLink.get(file), index.get(dependency)));
    }
  }

  if (lowLink.get(file) !== index.get(file)) return;
  const component = [];
  let current;
  do {
    current = stack.pop();
    onStack.delete(current);
    component.push(current);
  } while (current !== file);
  if (component.length > 1 || graph.get(file).includes(file)) {
    violations.push(`module cycle: ${component.sort((a, b) => a.localeCompare(b)).join(" -> ")}`);
  }
}

for (const file of graph.keys()) if (!index.has(file)) visit(file);

if (violations.length) {
  console.error(`code-shape check failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:code-shape ok — ${productionFiles.length} production modules are cycle-free; ${testFiles.length} test files contain no focus/skip or hidden type errors`);
