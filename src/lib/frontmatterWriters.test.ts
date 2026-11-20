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
