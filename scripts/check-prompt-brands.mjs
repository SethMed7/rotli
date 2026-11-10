// check:prompt-brands — nothing forges the prompt brands (src/lib/promptText.ts).
//
// The class this guards (third review of pull request 267, 2026-11-09): three rounds of
// review each found another path by which a note's text reached a model without
// the approved read. The send boundary now accepts only `PromptText`, built
// from source literals and typed pieces, and note-derived text exists only as
// `ApprovedText`, made only inside src/ai/approvedRead.ts. The compiler checks
// the rest, provided nobody casts around it. So, outside the owners and tests:
//
// 1. no `as` cast and no type argument to a brand (`as PromptText`,
//    `as unknown as ApprovedText`, `as Approved<…>`, `invoke<ApprovedText>(…)`);
// 2. the constructors that accept any string (personText, modelText,
//    externalText) and the reshapers (reshape, reshapeAsync) are imported only
//    by the modules named below, each with its reason; adding one is a
//    reviewed change;
// 3. a reshape keeps its input: a change function that ignores its text
//    (`reshape(x, () => other)`) is a forgery;
// 4. ai/approvedRead.ts never exports its constructor;
// 5. the test constructors (lib/promptText.fixtures.ts) and any other
//    `*.fixtures.ts` test support are imported only by tests and fixtures.
//
// Known limit: a value typed `any` (JSON.parse, an untyped import) is
// assignable to a brand without a cast. oxlint's no-explicit-any keeps `any`
// out of written code; the IPC façade (lib/tauri.ts) types every reply.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BRANDS = ["PromptText", "ApprovedText", "PersonText", "ModelText", "ExternalText", "PromptPart"];
const BRAND = `(?:${BRANDS.join("|")}|Approved<)`;
const CAST = new RegExp(`\\bas\\s+(?:unknown\\s+as\\s+)?${BRAND}`);
const TYPE_ARGUMENT = new RegExp(`\\b\\w+<[^<>()]*\\b(?:${BRANDS.join("|")})\\b[^<>()]*>\\(`);
const OPEN_CONSTRUCTORS = ["personText", "modelText", "externalText", "reshape", "reshapeAsync"];
const IGNORED_INPUT = /\breshape(?:Async)?\([^;]*?,\s*(?:async\s*)?\(\s*\)\s*=>/;

/** The brand owners: the one file each brand is made in. */
export const OWNERS = {
  "src/lib/promptText.ts": BRANDS.concat("Approved<"),
  "src/ai/approvedRead.ts": ["ApprovedText", "Approved<"],
};

/** Who may import an open constructor, and why. */
export const CONSTRUCTOR_IMPORTERS = {
  "src/ai/chatTitle.ts": "reshapes the person's first message",
  "src/ai/handToAiRefine.ts": "the shipped prompt asset; trims the approved hand-off",
  "src/ai/host.ts": "web results, error and status lines; ids and titles a model chose",
  "src/ai/hostFiles.ts": "refusal lines; decodes approved file bytes",
  "src/ai/hybrid.ts": "the person's preset routes; the organizer's rewrite",
  "src/ai/inlineAi.ts": "the shipped prompt asset; cuts the approved note at the cursor",
  "src/ai/loop.ts": "tool errors; the model's own steps; renumbers web evidence",
  "src/ai/nativeLoop.ts": "the attached note's id; the model's own calls",
  "src/ai/prompt.ts": "defuses untrusted text in place",
  "src/ai/tools.ts": "truncates and frames tool results; the model's own query",
  "src/chatMemory/composition.ts": "cuts the notes section out of the approved read",
  "src/chatMemory/model.ts": "compacts chat turns",
  "src/components/chat/chatSurface.tsx": "the person's composer text and the model's replies",
  "src/components/settingsSurface.tsx": "the person's description of their usage",
  "src/editor/librarianBar.tsx": "the person's Librarian ask",
  "src/editor/librarianChat.tsx": "the person's Librarian ask",
  "src/editor/librarianSession.ts": "the person's own Librarian rules",
  "src/lib/librarianChat.ts": "cuts the approved note and highlighted passage",
  "src/services/chatAutoTitle.ts": "the person's first message",
  "src/services/inlineAi.ts": "the person's /ai ask; cuts the approved note",
  "src/services/librarianBar.ts": "the Librarian model's reply",
};

/** Test-side: a test, or a `*.fixtures.ts` module tests share. */
const isTest = (path) => /\.(test|fixtures)\.tsx?$/.test(path);
const FIXTURES = "src/lib/promptText.fixtures.ts";

function code(source) {
  return source
    .split("\n")
    .map((line) => (line.trim().startsWith("//") || line.trim().startsWith("*") ? "" : line));
}

/** Every failure for a set of `{ path, source }` files (paths relative to the repo). */
export function brandFailures(files) {
  const failures = [];
  for (const { path, source } of files) {
    if (isTest(path)) continue;
    const owned = OWNERS[path] ?? [];
    code(source).forEach((line, index) => {
      const at = `${path}:${index + 1}`;
      for (const pattern of [CAST, TYPE_ARGUMENT]) {
        const found = pattern.exec(line);
        // a generic's own declaration (`<T extends PromptPart>(`) is not a forgery
        if (found && !/\bextends\b/.test(found[0]) && !owned.some((brand) => found[0].includes(brand))) {
          failures.push(
            `${at}: forges a prompt brand (${found[0].trim()}); build it with prompt\`…\` from typed pieces, or read it through ai/approvedRead.ts`,
          );
        }
      }
      if (IGNORED_INPUT.test(line)) {
        failures.push(
          `${at}: a reshape whose change ignores its text replaces it; transform the text it is given`,
        );
      }
    });
    if (/from\s*"[^"]*\.fixtures"/.test(source)) {
      failures.push(
        `${path}: imports test support (a *.fixtures module, such as ${FIXTURES}) outside a test`,
      );
    }
    for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]*promptText)"/g)) {
      const names = m[1].split(",").map(
        (raw) =>
          raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0],
      );
      const open = names.filter((name) => OPEN_CONSTRUCTORS.includes(name));
      if (open.length && !(path in CONSTRUCTOR_IMPORTERS)) {
        failures.push(
          `${path}: imports ${open.join(", ")} from lib/promptText; only the modules in CONSTRUCTOR_IMPORTERS (scripts/check-prompt-brands.mjs) may, each with a reason`,
        );
      }
    }
    if (
      path === "src/ai/approvedRead.ts" &&
      /export\s+(?:const|function)\s+approve\b|export\s*\{[^}]*\bapprove\b/.test(source)
    ) {
      failures.push(`${path}: exports its ApprovedText constructor`);
    }
  }
  const present = new Set(files.map((file) => file.path));
  for (const path of Object.keys(CONSTRUCTOR_IMPORTERS)) {
    if (present.size && !present.has(path))
      failures.push(`${path}: named in CONSTRUCTOR_IMPORTERS but gone; remove it`);
  }
  return failures;
}

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

if (import.meta.main) {
  const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
  const files = sources(join(root, "src")).map((path) => ({
    path: relative(root, path),
    source: readFileSync(path, "utf8"),
  }));
  const failures = brandFailures(files);
  if (failures.length) {
    console.error(`check:prompt-brands failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(
    `check:prompt-brands ok — no prompt brand is cast or forged; ${Object.keys(CONSTRUCTOR_IMPORTERS).length} modules may use the open constructors`,
  );
}
