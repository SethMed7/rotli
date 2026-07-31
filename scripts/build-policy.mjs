export const MAX_INITIAL_CHUNK_KIB = 1600;
export const MAX_LAZY_CHUNK_KIB = 3600;

const JSXGRAPH_EVAL_SOURCE = "/node_modules/jsxgraph/src/parser/jessiecode.js";

/** JSXGraph ships an optional compiler that contains eval. Rotli pins its
 * JessieCode interpreter to compile:false in check:structure, so the compiler
 * path is unreachable. Suppress only that exact vendor warning. */
export function shouldIgnoreBuildWarning(warning) {
  return warning.code === "EVAL" && warning.id?.replaceAll("\\", "/").endsWith(JSXGRAPH_EVAL_SOURCE);
}

export const LAZY_LOCALE_STUB_ID = "\0rotli-lazy-locale-stub";
export const LAZY_LOCALE_STUB_SOURCE = "export default {};\n";

/** Perf-audit 2026-07-30 finding 17: two vendor lazy-loader tables ship ~6 MB
 * of per-locale chunks rotli can never load — Univer's hyphenation pattern
 * dictionaries (77 locales; loadPattern() no-ops when the module lacks its
 * export) and Excalidraw's UI translations (rotli never passes langCode, so
 * only the bundled English fallback is ever used). Both resolve to one shared
 * empty stub; English variants are kept as insurance for both engines. */
export function shouldStubLazyLocale(source, importer) {
  if (!importer) return false;
  const from = importer.replaceAll("\\", "/");
  if (from.includes("@univerjs/engine-render/lib/es/")) {
    return /^\.\/(?!en)[a-z0-9-]+-[A-Za-z0-9_-]+\.js$/.test(source) && source !== "./index.js";
  }
  if (from.includes("@excalidraw/excalidraw/dist/prod/")) {
    return /^\.\/locales\/(?!en)[A-Za-z-]+-[A-Za-z0-9_-]+\.js$/.test(source);
  }
  return false;
}

function bytes(source) {
  return new TextEncoder().encode(source).byteLength;
}

/** Enforce separate budgets for the startup graph and opt-in editor engines.
 * Static imports of an entry are startup code; dynamic imports are lazy. */
export function bundleBudgetViolations(bundle) {
  const chunks = new Map(
    Object.values(bundle)
      .filter((item) => item.type === "chunk")
      .map((chunk) => [chunk.fileName, chunk]),
  );
  const initial = new Set();

  function visit(fileName) {
    if (initial.has(fileName)) return;
    const chunk = chunks.get(fileName);
    if (!chunk) return;
    initial.add(fileName);
    for (const dependency of chunk.imports) visit(dependency);
  }

  for (const chunk of chunks.values()) {
    if (chunk.isEntry) visit(chunk.fileName);
  }

  const violations = [];
  for (const chunk of chunks.values()) {
    const sizeKib = bytes(chunk.code) / 1024;
    const limitKib = initial.has(chunk.fileName) ? MAX_INITIAL_CHUNK_KIB : MAX_LAZY_CHUNK_KIB;
    if (sizeKib > limitKib) {
      violations.push(
        `${chunk.fileName}: ${sizeKib.toFixed(1)} KiB exceeds the ${initial.has(chunk.fileName) ? "startup" : "lazy"} budget of ${limitKib} KiB`,
      );
    }
  }
  return violations;
}
