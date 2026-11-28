// check:product-name — every "Rotli" a person reads either goes through the
// host words (src/host/registry.ts, src-tauri/src/app_identity.rs) or is
// listed in scripts/product-name-allowlist.json with the reason it stays.
// docs/architecture/host-seams.md, "Keeping the name honest".
//
// What it reads, and what it doesn't:
// - TypeScript and TSX under src/ (tests, fixtures and lanes aside), parsed
//   with the TypeScript compiler: string literals, every part of a template,
//   and JSX text. Comments never count. A bare lower-case token with no space
//   ("rotli", "rotli-settings") is an identifier, not words, and console
//   messages are for developers.
// - Rust under src-tauri/src/ (tests aside): string literals, read by line.
// - index.html's <title>.
// It doesn't read JSON assets (the Welcome catalog), CSS `content`, Markdown
// shipped as notes, or text a model writes. Those are listed in the contract.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript6";

export const ALLOWLIST = "scripts/product-name-allowlist.json";

const NAME = /\brotli\b/i;
// code tokens: a link scheme, an event or command prefix, a dot-folder, a
// file or package name, the website, an env var
const TOKEN = /rotli(?::\/\/|:[a-z]|[-_/@]|\.(?=\w))|[-_./@]rotli\b|\bROTLI_/gi;

/** The words in `text` that name the app, once code tokens are taken out. */
export function namesTheApp(text) {
  const words = text.replace(TOKEN, " ");
  if (!NAME.test(words)) return false;
  // a lone identifier-like token ("rotli", "rotliSection") is code
  return !/^[a-z0-9_$-]*$/.test(text.trim()) || /[A-Z]/.test(text.trim().charAt(0));
}

const isTestSide = (path) => /\.(test|fixtures|lane)\.tsx?$/.test(path) || /\/__tests__\//.test(path);

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

const inConsole = (node) => {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isCallExpression(at)) {
      const callee = at.expression;
      return (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "console"
      );
    }
    if (ts.isBlock(at) || ts.isSourceFile(at)) return false;
  }
  return false;
};

const isClassName = (node) => ts.isJsxAttribute(node.parent) && node.parent.name.getText() === "className";

const isModuleName = (node) =>
  ts.isImportDeclaration(node.parent) ||
  ts.isExportDeclaration(node.parent) ||
  ts.isExternalModuleReference(node.parent) ||
  (ts.isCallExpression(node.parent) && node.parent.expression.kind === ts.SyntaxKind.ImportKeyword);

/** Every literal in one TypeScript source that names the app. */
export function tsLiterals(path, source) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const visit = (node) => {
    let text = null;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      text = node.text;
    else if (ts.isJsxText(node)) text = node.text.replace(/\s+/g, " ").trim();
    if (
      text &&
      namesTheApp(text) &&
      !isModuleName(node) &&
      !isClassName(node) &&
      !inConsole(node) &&
      !ts.isLiteralTypeNode(node.parent)
    )
      found.push({
        text: text.replace(/\s+/g, " ").trim(),
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Calls that read the host's name as a module loads: outside any function,
 * getter or method. The first read locks the registry, and a host's own
 * registration module may import Rotli modules before it registers, so only
 * the app's root module (MODULE_LOAD_READERS) may read it there. */
export const MODULE_LOAD_READERS = new Set(["src/app.tsx"]);
const NAME_READS = new Set(["productName", "inlineName", "appHost"]);

export function moduleLoadReads(path, source) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && NAME_READS.has(node.expression.text))
      found.push({
        call: node.expression.text,
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Every string literal in one Rust source that names the app, tests aside:
 * a `#[cfg(test)]` module is skipped to its closing brace. */
export function rustLiterals(source) {
  const lines = source.split("\n");
  const found = [];
  let skipDepth = 0;
  const braces = (line) => {
    const code = line.replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/'.'/g, "");
    return (code.match(/\{/g)?.length ?? 0) - (code.match(/\}/g)?.length ?? 0);
  };
  for (const [index, line] of lines.entries()) {
    if (skipDepth > 0) {
      skipDepth += braces(line);
      continue;
    }
    if (
      /^\s*#\[cfg\(test\)\]/.test(line) &&
      /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/.test(lines[index + 1] ?? "")
    ) {
      skipDepth = 0;
      // the module's own line opens it
      continue;
    }
    if (
      index > 0 &&
      /^\s*#\[cfg\(test\)\]/.test(lines[index - 1] ?? "") &&
      /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/.test(line)
    ) {
      skipDepth = braces(line);
      continue;
    }
    const code = line.replace(/^\s*\/\/.*$/, "").replace(/\s\/\/[^"]*$/, "");
    if (/\b(?:e?println|log::\w+|tracing::\w+|debug_assert\w*|assert\w*)!\(/.test(code)) continue;
    for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const text = match[1];
      // "rotli: …" and "[rotli] …" open a developer log line on stderr
      if (/^(?:\{\} )?(?:rotli: |\[rotli\] )/.test(text)) continue;
      if (namesTheApp(text)) found.push({ text, line: index + 1 });
    }
  }
  return found;
}

/** Module-load reads of the host's name across src/, as failures. */
export function moduleLoadFailures(root) {
  const failures = [];
  for (const path of walk(
    join(root, "src"),
    (p) => /\.tsx?$/.test(p) && !isTestSide(p) && !p.endsWith(".d.ts"),
  )) {
    const rel = relative(root, path);
    if (MODULE_LOAD_READERS.has(rel) || rel === "src/host/registry.ts") continue;
    for (const { call, line } of moduleLoadReads(path, readFileSync(path, "utf8")))
      failures.push(
        `${rel}:${line}: ${call}() runs as the module loads, which locks the host registry before a host that imports this module can register; read it inside a function or a getter`,
      );
  }
  return failures;
}

/** What names the app across the tree, by file. */
export function scan(root) {
  const byFile = {};
  const add = (path, list) => {
    if (list.length) byFile[relative(root, path)] = list;
  };
  for (const path of walk(
    join(root, "src"),
    (p) => /\.tsx?$/.test(p) && !isTestSide(p) && !p.endsWith(".d.ts"),
  ))
    add(path, tsLiterals(path, readFileSync(path, "utf8")));
  for (const path of walk(join(root, "src-tauri/src"), (p) => p.endsWith(".rs") && !/_tests?\.rs$/.test(p)))
    add(path, rustLiterals(readFileSync(path, "utf8")));
  const html = join(root, "index.html");
  if (existsSync(html)) {
    const title = /<title>([^<]*)<\/title>/.exec(readFileSync(html, "utf8"));
    if (title && namesTheApp(title[1])) add(html, [{ text: title[1], line: 0 }]);
  }
  return byFile;
}

/** Failures: a literal the allowlist doesn't name, a listed one that is gone,
 * and a reason that isn't one of the categories. */
export function productNameFailures(found, allowlist) {
  const failures = [];
  const categories = allowlist.categories ?? {};
  const allowed = allowlist.allowed ?? {};
  for (const [file, list] of Object.entries(found)) {
    const listed = allowed[file] ?? {};
    for (const { text, line } of list)
      if (!(text in listed))
        failures.push(
          `${file}:${line}: "${text}" names the app outside the host words; route it through productName() or inlineName() (in Rust, app_identity::app_name() or product_name()), or list it in ${ALLOWLIST} with a category`,
        );
  }
  for (const [file, texts] of Object.entries(allowed)) {
    const present = new Set((found[file] ?? []).map((item) => item.text));
    for (const [text, category] of Object.entries(texts)) {
      if (!present.has(text)) failures.push(`${ALLOWLIST}: "${text}" is no longer in ${file}; remove it`);
      if (!(category in categories))
        failures.push(`${ALLOWLIST}: "${text}" in ${file} has no category "${category}"`);
    }
  }
  return failures;
}

if (import.meta.main) {
  const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
  const found = scan(root);
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify(found, null, 2));
    process.exit(0);
  }
  const allowlist = JSON.parse(readFileSync(join(root, ALLOWLIST), "utf8"));
  const failures = [...productNameFailures(found, allowlist), ...moduleLoadFailures(root)];
  if (failures.length) {
    console.error(`check:product-name failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  const count = Object.values(allowlist.allowed).reduce((n, texts) => n + Object.keys(texts).length, 0);
  console.log(
    `check:product-name ok — every other "Rotli" a person reads goes through the host words; ${count} listed as Rotli's own`,
  );
}
