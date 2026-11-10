// check:prompt-brands — no module outside the owners makes a prompt brand
// (src/lib/promptText.ts) by hand.
//
// What this is, and isn't (fourth review of PR 267, 2026-11-10): the brands
// make the model-bound paths enumerable and stop ACCIDENTAL misuse: a note
// read the wrong way doesn't compile into a request. They are not a proof
// against code written on purpose to get around them; that is what review is
// for. This check closes the bypasses the reviews found, reading the code
// with the TypeScript compiler (syntax and types, never a text search):
//
// 1. no cast to a brand (`as PromptText`, through any type alias, and to a
//    type that holds one, such as `Approved<…>`), outside the brand's owner;
// 2. no user-defined type guard that asserts a brand (`x is PromptText`);
// 3. no `any` (JSON.parse, an untyped value) flowing where a brand is
//    expected: a declaration, an assignment, a return, an argument, a field;
// 4. `prompt` only as a template tag, never called on a hand-built
//    TemplateStringsArray; `fixed` only on a literal written in the source
//    (a string, or a template with no substitutions);
// 5. the open constructors (personText, modelText, externalText, reshape,
//    reshapeAsync) used only by the modules in CONSTRUCTOR_USERS, and each
//    module only the constructors listed for it, found by resolved symbol, so
//    a renamed or namespace import or a re-export counts; no namespace import
//    of promptText, and no re-export of an open constructor, outside the owner;
// 6. a reshape's change uses the text it is given;
// 7. ai/approvedRead.ts never exports its constructor;
// 8. test support (`*.fixtures.ts`, such as lib/promptText.fixtures.ts) is
//    imported only by tests and other fixtures.
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import ts from "typescript6";

const PROMPT_TEXT = "src/lib/promptText.ts";
const APPROVED_READ = "src/ai/approvedRead.ts";
const BRAND_OF = {
  promptBrand: "PromptText",
  approvedBrand: "ApprovedText",
  personBrand: "PersonText",
  modelBrand: "ModelText",
  externalBrand: "ExternalText",
};
const BRAND_PROP = /^__@(promptBrand|approvedBrand|personBrand|modelBrand|externalBrand)@/;
const OPEN_CONSTRUCTORS = new Set(["personText", "modelText", "externalText", "reshape", "reshapeAsync"]);

/** The brands each owner may make. */
export const OWNERS = {
  [PROMPT_TEXT]: new Set(Object.values(BRAND_OF)),
  [APPROVED_READ]: new Set(["ApprovedText"]),
};

/** Who may use an open constructor, which ones, and why. */
export const CONSTRUCTOR_USERS = {
  "src/ai/chatTitle.ts": { uses: ["reshape"], why: "reshapes the person's first message" },
  "src/ai/handToAiRefine.ts": {
    uses: ["externalText", "reshape"],
    why: "the shipped prompt asset; trims the approved hand-off",
  },
  "src/ai/host.ts": {
    uses: ["externalText", "modelText"],
    why: "web results, error and status lines; ids and titles a model chose",
  },
  "src/ai/hostFiles.ts": {
    uses: ["externalText", "modelText", "reshapeAsync"],
    why: "refusal lines; the model's own query; decodes approved file bytes",
  },
  "src/ai/hybrid.ts": {
    uses: ["externalText", "modelText", "personText"],
    why: "the model catalog; the organizer's rewrite; the person's preset routes",
  },
  "src/ai/inlineAi.ts": {
    uses: ["externalText", "reshape"],
    why: "the shipped prompt asset; cuts the approved note at the cursor",
  },
  "src/ai/loop.ts": {
    uses: ["externalText", "modelText", "reshape"],
    why: "tool errors; the model's own steps; renumbers web evidence",
  },
  "src/ai/nativeLoop.ts": {
    uses: ["externalText", "modelText"],
    why: "the attached note's id and tool errors; the model's own calls",
  },
  "src/ai/prompt.ts": { uses: ["reshape"], why: "defuses untrusted text in place" },
  "src/ai/tools.ts": {
    uses: ["modelText", "reshape"],
    why: "the model's own query and steps; truncates and frames tool results",
  },
  "src/chatMemory/composition.ts": {
    uses: ["reshape"],
    why: "cuts the notes section out of the approved read",
  },
  "src/chatMemory/model.ts": { uses: ["reshape"], why: "compacts chat turns" },
  "src/components/chat/chatSurface.tsx": {
    uses: ["modelText", "personText"],
    why: "the person's composer text and the model's replies",
  },
  "src/components/settingsSurface.tsx": {
    uses: ["personText"],
    why: "the person's description of their usage",
  },
  "src/editor/librarianSession.ts": {
    uses: ["personText"],
    why: "the person's own Librarian rules, and the ask a composer sends (sendTyped)",
  },
  "src/lib/claudeSession.ts": { uses: ["externalText"], why: "a tool that threw: its error line" },
  "src/lib/librarianChat.ts": {
    uses: ["personText", "reshape"],
    why: "the person's rule groups; cuts the approved note and highlighted passage",
  },
  "src/services/chatAutoTitle.ts": { uses: ["personText"], why: "the person's first message" },
  "src/services/inlineAi.ts": {
    uses: ["personText", "reshape"],
    why: "the person's /ai ask; cuts the approved note",
  },
  "src/services/librarianBar.ts": { uses: ["modelText"], why: "the Librarian model's reply" },
};

/** Test-side: a test, or a `*.fixtures.ts` module tests share. */
const isTestSide = (path) => /\.(test|fixtures)\.tsx?$/.test(path);

function brandNamesOf(checker, type, seen = new Set(), depth = 0) {
  const found = new Set();
  if (!type || seen.has(type) || depth > 3) return found;
  seen.add(type);
  const add = (names) => names.forEach((name) => found.add(name));
  if (type.isUnion() || type.isIntersection()) {
    for (const part of type.types) add(brandNamesOf(checker, part, seen, depth));
  }
  for (const prop of checker.getPropertiesOfType(type)) {
    const brand = BRAND_PROP.exec(String(prop.escapedName));
    if (brand) found.add(BRAND_OF[brand[1]]);
  }
  if (found.size || type.flags & ts.TypeFlags.StringLike) return found;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    for (const arg of checker.getTypeArguments(type)) add(brandNamesOf(checker, arg, seen, depth + 1));
  } else if (type.flags & ts.TypeFlags.Object && type.getCallSignatures().length === 0 && depth < 2) {
    // a row of approved fields (`Approved<…>`): one level of its properties
    for (const prop of checker.getPropertiesOfType(type).slice(0, 64)) {
      const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
      if (!declaration) continue;
      add(brandNamesOf(checker, checker.getTypeOfSymbolAtLocation(prop, declaration), seen, depth + 1));
    }
  }
  return found;
}

function resolvedSymbol(checker, node) {
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return symbol;
}

/** The name an identifier resolves to in lib/promptText.ts, or null. */
function promptTextName(checker, node, root) {
  const symbol = resolvedSymbol(checker, node);
  const declaration = symbol?.declarations?.[0];
  if (!declaration) return null;
  return relative(root, declaration.getSourceFile().fileName) === PROMPT_TEXT ? symbol.name : null;
}

function usesItsParameter(checker, fn) {
  const param = fn.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return false;
  const target = checker.getSymbolAtLocation(param.name);
  let used = false;
  const visit = (node) => {
    if (used) return;
    const symbol =
      ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : ts.isIdentifier(node)
          ? checker.getSymbolAtLocation(node)
          : undefined;
    if (ts.isIdentifier(node) && node !== param.name && symbol === target) used = true;
    else ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return used;
}

/** Does `type` hold an `any` anywhere a JSON value could carry it? */
function holdsAny(checker, type, depth = 0) {
  if (!type || depth > 3) return false;
  if (type.flags & ts.TypeFlags.Any) return true;
  if (type.isUnion() || type.isIntersection())
    return type.types.some((part) => holdsAny(checker, part, depth));
  if (checker.isArrayType(type) || checker.isTupleType(type))
    return checker.getTypeArguments(type).some((arg) => holdsAny(checker, arg, depth + 1));
  if (type.flags & ts.TypeFlags.Object && type.getCallSignatures().length === 0) {
    return checker
      .getPropertiesOfType(type)
      .slice(0, 64)
      .some((prop) => {
        const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
        return (
          !!declaration && holdsAny(checker, checker.getTypeOfSymbolAtLocation(prop, declaration), depth + 1)
        );
      });
  }
  return false;
}

const SUPPRESSION = /@ts-(?:ignore|expect-error|nocheck)\b/;

/** Every failure in `program`'s files under src/ (paths relative to `root`). */
export function programFailures(program, root, only) {
  const checker = program.getTypeChecker();
  const failures = [];
  const usage = new Map();
  for (const file of program.getSourceFiles()) {
    const path = relative(root, file.fileName);
    if (!path.startsWith("src/") || isTestSide(path)) continue;
    if (only && !only.has(path)) continue;
    const owned = OWNERS[path] ?? new Set();
    const at = (node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
    const fail = (node, message) => failures.push(`${at(node)}: ${message}`);
    // fifth review: a declaration file may not name a brand (it would claim a
    // branded value no code made), and nothing outside tests may switch the
    // checker off for a line or a file
    if (file.isDeclarationFile) {
      const named = (node) => {
        if (ts.isTypeReferenceNode(node) && brandNamesOf(checker, checker.getTypeFromTypeNode(node)).size)
          fail(node, "a declaration file names a prompt brand; brands are made only by their owners");
        ts.forEachChild(node, named);
      };
      named(file);
      continue;
    }
    const commentText = file.getFullText();
    ts.forEachChild(file, function comments(node) {
      for (const range of ts.getLeadingCommentRanges(commentText, node.getFullStart()) ?? []) {
        if (SUPPRESSION.test(commentText.slice(range.pos, range.end)))
          failures.push(
            `${path}:${file.getLineAndCharacterOfPosition(range.pos).line + 1}: a type-check suppression (a @ts- ignore, expect-error or nocheck directive) outside a test`,
          );
      }
      ts.forEachChild(node, comments);
    });
    const unowned = (names) => [...names].filter((name) => !owned.has(name));
    const anyInto = (expr) => {
      if (!expr) return;
      const type = checker.getTypeAtLocation(expr);
      if (!(type.flags & ts.TypeFlags.Any)) return;
      const wanted = unowned(brandNamesOf(checker, checker.getContextualType(expr)));
      if (wanted.length)
        fail(
          expr,
          `an \`any\` value becomes ${wanted.join(", ")}; read it through ai/approvedRead.ts or build it with prompt\`…\``,
        );
    };
    const visit = (node) => {
      // a brand the source didn't already carry is a brand made here
      const made = (target, source) => {
        const had = brandNamesOf(checker, source);
        return unowned(brandNamesOf(checker, target)).filter((name) => !had.has(name));
      };
      if (
        (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
        !ts.isConstTypeReference(node.type)
      ) {
        const forged = made(
          checker.getTypeFromTypeNode(node.type),
          checker.getTypeAtLocation(node.expression),
        );
        if (forged.length)
          fail(
            node,
            `casts to a prompt brand (${forged.join(", ")}); build it with prompt\`…\` from typed pieces, or read it through ai/approvedRead.ts`,
          );
      }
      if (ts.isTypePredicateNode(node) && node.type) {
        // narrowing a value that may already be branded is fine; asserting a
        // brand onto one that can't be is a forgery
        const fn = node.parent;
        const param = ts.isIdentifier(node.parameterName)
          ? fn.parameters?.find((p) => ts.isIdentifier(p.name) && p.name.text === node.parameterName.text)
          : undefined;
        const from = param ? checker.getTypeAtLocation(param) : undefined;
        const asserted = made(checker.getTypeFromTypeNode(node.type), from);
        if (asserted.length) fail(node, `a type guard asserts a prompt brand (${asserted.join(", ")})`);
      }
      if (ts.isVariableDeclaration(node) && node.type) anyInto(node.initializer);
      if (ts.isParameter(node) && node.type) anyInto(node.initializer);
      if (ts.isSatisfiesExpression(node)) {
        const forged = made(
          checker.getTypeFromTypeNode(node.type),
          checker.getTypeAtLocation(node.expression),
        );
        if (forged.length)
          fail(node, `\`satisfies\` claims a prompt brand (${forged.join(", ")}) the value doesn't carry`);
      }
      // an overload signature claiming a brand its implementation needn't
      // return (`function f(v): PromptText; function f(v): any { … }`)
      if (
        ts.isFunctionDeclaration(node) &&
        !node.body &&
        node.type &&
        !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)
      ) {
        const claimed = unowned(brandNamesOf(checker, checker.getTypeFromTypeNode(node.type)));
        if (claimed.length)
          fail(
            node,
            `an overload claims a prompt brand (${claimed.join(", ")}); return one built by its owner`,
          );
      }
      if (ts.isReturnStatement(node)) anyInto(node.expression);
      if (ts.isPropertyAssignment(node)) anyInto(node.initializer);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
        anyInto(node.right);
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) anyInto(node.body);
      if (ts.isCallExpression(node)) {
        node.arguments.forEach(anyInto);
        const name = promptTextName(
          checker,
          ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression,
          root,
        );
        if (name === "prompt")
          fail(node, "prompt is a template tag: write prompt`…`, never call it on a hand-built array");
        if (
          name === "promptJson" &&
          node.arguments[0] &&
          holdsAny(checker, checker.getTypeAtLocation(node.arguments[0]))
        )
          fail(node, "promptJson's value holds an `any`; every string in it must be a typed piece");
        if (name === "fixed") {
          const arg = node.arguments[0];
          if (!arg || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)))
            fail(node, "fixed takes only a literal written here; for text with pieces, use prompt`…`");
        }
        if (name === "reshape" || name === "reshapeAsync") {
          const change = node.arguments[1];
          if (
            change &&
            (ts.isArrowFunction(change) || ts.isFunctionExpression(change)) &&
            !usesItsParameter(checker, change)
          )
            fail(node, "a reshape whose change ignores its text replaces it; transform the text it is given");
        }
      }
      if (ts.isIdentifier(node) && path !== PROMPT_TEXT) {
        const name = promptTextName(checker, node, root);
        if (name && OPEN_CONSTRUCTORS.has(name)) {
          if (!usage.has(path)) usage.set(path, new Map());
          if (!usage.get(path).has(name)) usage.get(path).set(name, node);
        }
      }
      if (ts.isImportDeclaration(node) && path !== PROMPT_TEXT) {
        const from = node.moduleSpecifier.text;
        if (from.endsWith(".fixtures"))
          fail(node, "imports test support (a *.fixtures module) outside a test");
        const bindings = node.importClause?.namedBindings;
        if (
          bindings &&
          ts.isNamespaceImport(bindings) &&
          promptTextModule(checker, node.moduleSpecifier, root)
        )
          fail(node, "a namespace import of lib/promptText; import the pieces by name");
      }
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        path !== PROMPT_TEXT &&
        promptTextModule(checker, node.moduleSpecifier, root)
      ) {
        const names =
          node.exportClause && ts.isNamedExports(node.exportClause)
            ? node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text)
            : null;
        if (!names || names.some((name) => OPEN_CONSTRUCTORS.has(name)))
          fail(node, "re-exports an open constructor of lib/promptText; import it from there");
      }
      if (
        path === APPROVED_READ &&
        ts.isVariableStatement(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const d of node.declarationList.declarations)
          if (ts.isIdentifier(d.name) && d.name.text === "approve")
            fail(d, "exports its ApprovedText constructor");
      }
      if (
        path === APPROVED_READ &&
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "approve" &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      )
        fail(node, "exports its ApprovedText constructor");
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  for (const [path, names] of usage) {
    const allowed = new Set(CONSTRUCTOR_USERS[path]?.uses ?? []);
    for (const [name, node] of names) {
      if (allowed.has(name)) continue;
      const file = node.getSourceFile();
      const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      failures.push(
        `${path}:${line}: uses ${name} from lib/promptText; CONSTRUCTOR_USERS (scripts/check-prompt-brands.mjs) lists ${allowed.size ? [...allowed].join(", ") : "nothing"} for this module, each with a reason`,
      );
    }
  }
  if (!only) {
    for (const [path, entry] of Object.entries(CONSTRUCTOR_USERS)) {
      const used = usage.get(path) ?? new Map();
      for (const name of entry.uses)
        if (!used.has(name))
          failures.push(
            `${path}: CONSTRUCTOR_USERS lists ${name} but the module no longer uses it; remove it`,
          );
    }
  }
  return failures;
}

function promptTextModule(checker, specifier, root) {
  const symbol = checker.getSymbolAtLocation(specifier);
  const declaration = symbol?.declarations?.[0];
  return !!declaration && relative(root, declaration.getSourceFile().fileName) === PROMPT_TEXT;
}

function compilerOptions(root) {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(root, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    },
  );
  return config;
}

/** The project's own files, checked. */
export function projectFailures(root) {
  const config = compilerOptions(root);
  const program = ts.createProgram(config.fileNames, config.options);
  return [
    ...programFailures(program, root),
    ...scriptFailures(ts.sys.readDirectory(join(root, "src")).map((file) => relative(root, file))),
  ];
}

const SCRIPT = /\.(?:js|jsx|mjs|cjs)$/;

/** Plain JavaScript under src/ is never type-checked, so a brand could be
 * forged there unseen; the app is TypeScript throughout, so any is refused. */
export function scriptFailures(paths) {
  return paths
    .filter((path) => path.startsWith("src/") && SCRIPT.test(path))
    .map(
      (path) =>
        `${path}: JavaScript under src/ isn't type-checked, so the prompt brands can't be checked there; write it in TypeScript`,
    );
}

/** Check extra in-memory sources (path relative to `root`) against the real
 * project they import: what the fixture tests use. */
export function sourceFailures(root, sources) {
  const config = compilerOptions(root);
  const virtual = new Map(Object.entries(sources).map(([path, text]) => [resolve(root, path), text]));
  const host = ts.createCompilerHost(config.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, ...rest) =>
    virtual.has(resolve(name))
      ? ts.createSourceFile(name, virtual.get(resolve(name)), language, true)
      : getSourceFile(name, language, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => virtual.has(resolve(name)) || fileExists(name);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => virtual.get(resolve(name)) ?? readFile(name);
  const program = ts.createProgram([...virtual.keys()], config.options, host);
  return [
    ...programFailures(program, root, new Set(Object.keys(sources))),
    ...scriptFailures(Object.keys(sources)),
  ];
}

if (import.meta.main) {
  const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
  if (!existsSync(join(root, PROMPT_TEXT))) throw new Error(`no ${PROMPT_TEXT} under ${root}`);
  const failures = projectFailures(root);
  if (failures.length) {
    console.error(`check:prompt-brands failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(
    `check:prompt-brands ok — no prompt brand is cast, asserted, or made from \`any\`; ${Object.keys(CONSTRUCTOR_USERS).length} modules use the open constructors, each as listed`,
  );
}
