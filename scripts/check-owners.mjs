#!/usr/bin/env bun
// check:owners — one owner per decision, for the classes the sixth review of
// pull request 267 found again and again in new places (CONTRIBUTING.md,
// "Review learnings become guards"):
//
// 1. An editor buffer is replaced, or declared saved, only by its owner:
//    inside src/editor/buffers.ts, `docs.set(` only in `seed`, `edit` and
//    `adopt`, and `recordSaved(` only in `seed` and `adopt`; and no other
//    module imports the generation ledger's writers (`recordSaved`,
//    `bumpGeneration`).
// 2. A turn's protection travels with the turn: no writer asks the
//    conversation again. `markedConversation` is gone for good; the
//    Librarian's settlement (librarianKeep.ts) never reads a conversation's
//    `onDeviceOnly`; the chat surface reads its live `secureReadRef` only
//    where a turn captures it at send, where a read raises it, and where the
//    person's own note button acts on the chat on screen.
// 3. Frontmatter is matched by one parser: a regular expression anchored on a
//    `---` fence, or a "\n---\n" string handed to a string search, appears
//    only in src/lib/frontmatterBlock.ts (and the files listed below, with
//    their reasons).
//
// Reads source with the TypeScript compiler's parser (syntax, not text).

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript6";

const isTestSide = (path) => /\.(test|fixtures|lane)\.tsx?$/.test(path);

/** Hand-written frontmatter matches allowed outside the shared parser. */
export const FENCE_OWNERS = {
  "src/lib/frontmatterBlock.ts": "the shared parser itself",
  "src/components/breve/breveDashboardModel.ts":
    "a Breve dashboard's own fence (CRLF-aware); it carries no protection mark",
  "src/components/breve/breveSurface.tsx":
    "a Breve report's own fence (CRLF-aware); it carries no protection mark",
  "src/ai/tools.ts":
    "a fence a model echoes back, which may carry trailing spaces (CRLF-aware); stripped before a write, never a protection mark",
};

/** Lines of the chat surface that may read the live `secureReadRef`. */
const LIVE_MARK_LINES = [
  /secureReadRef\.current = /, // the chat on screen loads, resets, or a read raises it
  /const attachedSecure = /, // a turn captures it at send
  /const marked = /, // the person's note button, on the chat on screen
];

function enclosingFunction(node) {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isFunctionDeclaration(at) && at.name) return at.name.text;
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent))
      return at.parent.name.getText();
  }
  return null;
}

/** Every failure in `files` ({ path: text }, paths relative to the repo). */
export function ownerFailures(files) {
  const failures = [];
  for (const [path, text] of Object.entries(files)) {
    if (!path.startsWith("src/") || isTestSide(path) || !/\.tsx?$/.test(path)) continue;
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const at = (node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
    const fail = (node, message) => failures.push(`${at(node)}: ${message}`);
    ts.forEachChild(file, function walk(node) {
      // 1. the buffer owner
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(file);
        const where = enclosingFunction(node);
        if (
          callee === "docs.set" &&
          !(path === "src/editor/buffers.ts" && ["seed", "edit", "adopt"].includes(where))
        )
          fail(
            node,
            "an editor buffer is replaced outside buffers.ts's seed/edit/adopt; go through `adopt` with the generation it was computed for",
          );
        if (
          callee === "recordSaved" &&
          !(path === "src/editor/buffers.ts" && ["seed", "adopt"].includes(where))
        )
          fail(node, "a note is declared saved outside buffers.ts's `adopt`");
      }
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier.text.endsWith("saveGenerations") &&
        path !== "src/editor/buffers.ts"
      ) {
        const names = node.importClause?.namedBindings;
        if (names && ts.isNamedImports(names))
          for (const name of names.elements)
            if (["recordSaved", "bumpGeneration"].includes((name.propertyName ?? name.name).text))
              fail(name, `imports ${name.name.text}: only buffers.ts moves a note's generations`);
      }
      // 2. a turn's protection
      if (ts.isIdentifier(node) && node.text === "markedConversation")
        fail(node, "a writer asks the conversation whether it is marked; use the turn's own protection");
      if (
        path === "src/editor/librarianKeep.ts" &&
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "onDeviceOnly" &&
        !/protection\??$/.test(node.expression.getText(file))
      )
        fail(node, "settlement reads a conversation's mark; it goes by the turn's `protection`");
      // 3. one frontmatter parser
      if (!(path in FENCE_OWNERS)) {
        if (ts.isRegularExpressionLiteral(node) && /\^(?:\\uFEFF\??)?\(?-{3}/.test(node.text))
          fail(
            node,
            "a hand-written frontmatter match; use lib/frontmatterBlock.ts (CRLF-aware, fails closed)",
          );
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ["replace", "includes", "indexOf", "split", "startsWith"].includes(node.expression.name.text) &&
          node.arguments.some((arg) => ts.isStringLiteral(arg) && /\n---(\n|$)/.test(arg.text))
        )
          fail(node, "a frontmatter fence searched as LF-only text; use lib/frontmatterBlock.ts");
      }
      ts.forEachChild(node, walk);
    });
    if (path === "src/components/chat/chatSurface.tsx") {
      text.split("\n").forEach((line, index) => {
        if (line.includes("secureReadRef.current") && !LIVE_MARK_LINES.some((rule) => rule.test(line)))
          failures.push(
            `${path}:${index + 1}: reads the chat's live mark where a turn writes; use the turn's captured \`turnMark\``,
          );
      });
    }
  }
  return failures;
}

function sourceFiles(root, dir = "src", out = {}) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(root, path, out);
    else if (/\.tsx?$/.test(entry.name)) out[path] = readFileSync(join(root, path), "utf8");
  }
  return out;
}

if (import.meta.main) {
  const root = process.cwd();
  const failures = ownerFailures(sourceFiles(root));
  if (failures.length) {
    console.error(
      `check:owners failed:\n${failures.map((f) => `  - ${relative(root, join(root, f))}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    "check:owners ok — buffers are replaced and declared saved only by their owner, turns carry their own protection, and frontmatter has one parser",
  );
}
