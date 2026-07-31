// Identifier-casing guard — replaces typescript-eslint's naming-convention
// (no oxlint equivalent; the rest of the lint layer moved to oxlint 2026-07-31).
// Same contract the ESLint rule held, measured at 0 real violations when
// adopted 2026-07-18:
//   - variables: camelCase | UPPER_CASE | PascalCase, leading underscores
//     allowed (discards), Vite `define` dunder globals (__APP_VERSION__) exempt
//   - type-likes (class, interface, type alias, enum, type parameter): PascalCase
//   - interfaces: additionally no I-prefix (IFoo)
// Scope matches the old rule: src/**/*.{ts,tsx} only.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
const violations = [];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if ([".ts", ".tsx"].includes(extname(path))) files.push(path);
  }
};
if (existsSync(join(root, "src"))) walk(join(root, "src"));

const DUNDER = /^__[A-Z0-9_]+__$/;
const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const UPPER = /^[A-Z][A-Z0-9_]*$/;
const PASCAL = /^[A-Z][a-zA-Z0-9]*$/;

function checkVariable(name, file, node) {
  if (DUNDER.test(name)) return;
  const stripped = name.replace(/^_+/, "");
  if (stripped === "" || CAMEL.test(stripped) || UPPER.test(stripped) || PASCAL.test(stripped)) return;
  report(file, node, `variable \`${name}\` must be camelCase, UPPER_CASE, or PascalCase (leading underscore allowed)`);
}

function checkTypeLike(name, file, node, kind) {
  if (!PASCAL.test(name)) report(file, node, `${kind} \`${name}\` must be PascalCase`);
  if (kind === "interface" && /^I[A-Z]/.test(name)) {
    report(file, node, `interface \`${name}\` must not use the I-prefix`);
  }
}

function report(file, node, message) {
  const source = node.getSourceFile();
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  violations.push(`${relative(root, file)}:${line + 1} ${message}`);
}

function bindingNames(name, out) {
  if (ts.isIdentifier(name)) out.push(name);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindingNames(element.name, out);
    }
  }
}

for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, extname(file) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const names = [];
      bindingNames(node.name, names);
      for (const id of names) checkVariable(id.text, file, id);
    } else if (ts.isInterfaceDeclaration(node)) {
      checkTypeLike(node.name.text, file, node.name, "interface");
    } else if (ts.isTypeAliasDeclaration(node)) {
      checkTypeLike(node.name.text, file, node.name, "type alias");
    } else if (ts.isEnumDeclaration(node)) {
      checkTypeLike(node.name.text, file, node.name, "enum");
    } else if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
      checkTypeLike(node.name.text, file, node.name, "class");
    } else if (ts.isTypeParameterDeclaration(node)) {
      checkTypeLike(node.name.text, file, node.name, "type parameter");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (violations.length) {
  console.error(`naming check failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:naming ok — ${files.length} src files hold the identifier-casing contract`);
