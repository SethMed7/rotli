// The guard for the writer class (Codex re-check of pull request 303): every
// function in src/ that composes a note's frontmatter text runs
// `guardFrontmatterWrite` (or `keepWrite`, its promise-checking wrapper), so
// no Web writer can leave a note more permissive than its action owns. A new
// writer fails this test until it does, or is named below with its reason.
// Twin of frontmatter_keys.rs `every_frontmatter_writer_runs_the_guard`.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript6";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const COMPOSERS = new Set([
  "composeNoteDocument",
  "composeInPlace",
  "withTopLevelLine",
  "withSecureLineOnly",
  "withKeyLines",
  "mergeRawFrontmatter",
  "composeNote",
]);
const GUARDS = ["guardFrontmatterWrite(", "keepWrite("];
const EXEMPT: Record<string, string> = {
  "src/lib/frontmatterInPlace.ts withTopLevelLine":
    "a pure composer: returns text; its callers write and guard it",
  "src/lib/frontmatterInPlace.ts withSecureLineOnly":
    "a pure composer: returns text; its callers write and guard it",
  "src/lib/frontmatterInPlace.ts composeInPlace":
    "a pure composer: returns text; its callers write and guard it",
  "src/memex/service.ts writeNote":
    "creates a new note (a fresh ulid): there is no earlier frontmatter to loosen",
  "src/services/folderNotes.ts createNote": "creates a new note: there is no earlier frontmatter to loosen",
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|\.d\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** The outermost function-like node around `node`, and its name. */
function enclosing(node: ts.Node): { fn: ts.Node; name: string } | null {
  let found: { fn: ts.Node; name: string } | null = null;
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at))
      found = { fn: at, name: at.name?.getText() ?? "<anonymous>" };
    else if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent))
      found = { fn: at, name: at.parent.name.getText() };
  }
  return found;
}

function unguardedWriters(): string[] {
  const out = new Set<string>();
  for (const path of sources(join(ROOT, "src"))) {
    const rel = relative(ROOT, path);
    const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name
          : node.expression;
        if (ts.isIdentifier(callee) && COMPOSERS.has(callee.text)) {
          const around = enclosing(node);
          const name = around?.name ?? "<top level>";
          const text = around?.fn.getText() ?? "";
          if (
            name !== callee.text &&
            !GUARDS.some((guard) => text.includes(guard)) &&
            !EXEMPT[`${rel} ${name}`]
          )
            out.add(`${rel} ${name}`);
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(file);
  }
  return [...out].sort();
}

test("every frontmatter writer runs the guard", () => {
  expect(unguardedWriters()).toEqual([]);
});

test("every exemption still names a function that composes frontmatter", () => {
  const named = new Set(Object.keys(EXEMPT).map((key) => key.split(" ")[0]));
  for (const file of named)
    expect(readFileSync(join(ROOT, file!), "utf8")).toMatch(/compose|withTopLevelLine|withSecureLineOnly/);
});

// Review of pull request 303 at 828f994d: a guard somewhere in a function
// is not enough (savedNoteText returned twice before its guard). In every
// function that composes or guards frontmatter, each write must write a value
// the guard saw, and a function that writes nothing must return only guarded
// values (or null): every path, not just one.
const WRITES: Record<string, number> = { writeVersionedFile: 2, writeFile: 1, writeText: 1 };
const GUARD_CALLS = new Set(["guardFrontmatterWrite", "keepWrite"]);

function ownFunction(node: ts.Node): ts.Node | undefined {
  for (let at = node.parent; at; at = at.parent) if (ts.isFunctionLike(at)) return at;
  return undefined;
}

function unguardedPaths(): string[] {
  const out: string[] = [];
  for (const path of sources(join(ROOT, "src"))) {
    const rel = relative(ROOT, path);
    const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const writers = new Map<
      ts.Node,
      { name: string; guarded: Set<string>; writes: ts.CallExpression[]; returns: ts.ReturnStatement[] }
    >();
    const calls: ts.CallExpression[] = [];
    const returns: ts.ReturnStatement[] = [];
    const collect = (node: ts.Node) => {
      if (ts.isCallExpression(node)) calls.push(node);
      if (ts.isReturnStatement(node)) returns.push(node);
      ts.forEachChild(node, collect);
    };
    collect(file);
    const calleeName = (call: ts.CallExpression) => {
      const callee = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
      return ts.isIdentifier(callee) ? callee.text : "";
    };
    for (const call of calls) {
      const name = calleeName(call);
      if (!COMPOSERS.has(name) && !GUARD_CALLS.has(name)) continue;
      const around = enclosing(call);
      if (!around || around.name === name || EXEMPT[`${rel} ${around.name}`]) continue;
      if (!writers.has(around.fn))
        writers.set(around.fn, { name: around.name, guarded: new Set(), writes: [], returns: [] });
      if (GUARD_CALLS.has(name) && call.arguments[1] && ts.isIdentifier(call.arguments[1]))
        writers.get(around.fn)!.guarded.add(call.arguments[1].text);
    }
    for (const call of calls) {
      const at = WRITES[calleeName(call)];
      const around = at === undefined ? null : enclosing(call);
      if (around && writers.has(around.fn)) writers.get(around.fn)!.writes.push(call);
    }
    for (const statement of returns) {
      const own = ownFunction(statement);
      if (own && writers.has(own)) writers.get(own)!.returns.push(statement);
    }
    for (const writer of writers.values()) {
      const ok = (expr: ts.Expression | undefined): boolean => {
        if (
          !expr ||
          expr.kind === ts.SyntaxKind.NullKeyword ||
          (ts.isIdentifier(expr) && expr.text === "undefined")
        )
          return true;
        if (ts.isParenthesizedExpression(expr) || ts.isAwaitExpression(expr)) return ok(expr.expression);
        if (ts.isIdentifier(expr)) return writer.guarded.has(expr.text);
        if (ts.isConditionalExpression(expr)) return ok(expr.whenTrue) && ok(expr.whenFalse);
        return false;
      };
      for (const call of writer.writes)
        if (
          !ok(call.arguments[WRITES[calleeName(call)]!]) &&
          !RETURNS_OK[`${rel} ${writer.name}: ${call.arguments[WRITES[calleeName(call)]!]?.getText()}`]
        )
          out.push(`${rel} ${writer.name}: writes ${call.arguments[WRITES[calleeName(call)]!]?.getText()}`);
      if (writer.writes.length > 0) continue;
      for (const statement of writer.returns) {
        const value = statement.expression;
        const text =
          value && ts.isObjectLiteralExpression(value)
            ? value.properties.find((p) => p.name?.getText() === "text")
            : undefined;
        const checked =
          text && ts.isPropertyAssignment(text)
            ? text.initializer
            : text && ts.isShorthandPropertyAssignment(text)
              ? text.name
              : value;
        if (!ok(checked) && !RETURNS_OK[`${rel} ${writer.name}: ${checked?.getText()}`])
          out.push(`${rel} ${writer.name}: returns ${checked?.getText()}`);
      }
    }
  }
  return out.sort();
}

/** Returns that hand back text unchanged, never a rewrite, with reasons. */
const RETURNS_OK: Record<string, string> = {
  "src/services/folderNoteAliases.ts prepareFolderTitleRename: text":
    "returns the text it was given (no rename, or a plain note): nothing is rewritten",
  "src/services/folderViewSync.ts writeFolderViews: contents": "writes the views file, not a note",
  "src/services/folderViewSync.ts writeFolderViews: raw": "writes Main's tree file, not a note",
  "src/services/folderViewSync.ts writeFolderViews: previous": "rolls a views file back to its bytes on disk",
  "src/services/folderViewSync.ts writeFolderViews: entry.before": "rolls a note back to its bytes on disk",
  "src/services/folderViewSync.ts writeFolderViews: ignoreRollback.before":
    "rolls `.gitignore` back to its bytes on disk",
};

test("every path a frontmatter writer takes writes or returns guarded text", () => {
  expect(unguardedPaths()).toEqual([]);
});
