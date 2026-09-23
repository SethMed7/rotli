import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { LIB_EFFECTFUL_FILE_OWNERS, sourceOwnershipViolations } from "./source-ownership.ts";

const root = process.cwd();

// Any feature with workflow.ts + composition.ts opts into the clean-feature
// convention automatically. New model/ports/retrieval/workflow files in that
// feature are protected without editing this script.
const cleanFeatureRoles = new Set(["model.ts", "ports.ts", "retrieval.ts", "workflow.ts"]);
const cleanFeatureDirs = readdirSync(join(root, "src"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, "src", entry.name))
  .filter((dir) => existsSync(join(dir, "workflow.ts")) && existsSync(join(dir, "composition.ts")));
const discoveredCleanFiles = cleanFeatureDirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => cleanFeatureRoles.has(name))
    .map((name) => relative(root, join(dir, name))),
);

// Opt-in-by-file-presence must never be a silent third state: a feature dir that
// carries clean-feature role files without the workflow.ts + composition.ts
// trigger pair is either fully split or named here with its reason. A listed dir
// that gains the full split (or vanishes) fails the check until its entry goes.
const cleanFeatureExemptions = {
  "src/sheets":
    "live Univer editing session — codec/engine adapters, kinds.ts policy constants, and the vendor seams below carry the boundaries; a model/ports/workflow split would be empty wrappers around the stateful engine handle",
  "src/boards":
    "session.ts + composition.ts share the corpus round-trip; the board model is Excalidraw's vendor scene JSON behind boards/engine — no domain layer to split",
  "src/noteChat":
    "model/composition/session mirror the seam shape without a workflow layer; model.ts stays pure (contract-only imports) under its colocated tests — a workflow.ts would be an empty trigger file",
  "src/editor":
    "model.ts is the live shared text buffer (a state store), not a clean-feature domain model — the filename collides with the role vocabulary; the editor's real boundaries are the slash + vendor seams",
};

const allowedLocalRoleImports = {
  "model.ts": [],
  "ports.ts": ["./model"],
  "retrieval.ts": ["./model", "./ports"],
  "workflow.ts": ["./model", "./ports", "./retrieval"],
};

const protectedLayers = [
  {
    files: discoveredCleanFiles,
    forbidden: ["react", "@tauri-apps/", "../components/", "../lib/tauri", "../state/", "./composition"],
  },
  {
    files: ["src/services/notesPort.ts"],
    forbidden: [
      "react",
      "@tauri-apps/",
      "../components/",
      "../lib/tauri",
      "../state/",
      "./notes",
      "./fsNotes",
    ],
  },
  {
    files: ["src/services/brainJournal.ts"],
    forbidden: [
      "react",
      "@tauri-apps/",
      "../components/",
      "../lib/tauri",
      "../state/",
      "./brainFiling",
      "./brainJournalComposition",
      "./brainJournalStore",
      "./hooks",
    ],
  },
  {
    files: ["src/memex/contract.ts", "src/memex/modelMap.ts"],
    forbidden: ["react", "@tauri-apps/", "../ai/", "../components/", "../lib/tauri", "../state/"],
  },
  {
    files: [
      "breve-runtime/scripts/brief-retention.ts",
      "breve-runtime/scripts/doctor-findings.ts",
      "breve-runtime/scripts/intents.ts",
      "breve-runtime/scripts/scheduler-core.ts",
      "breve-runtime/scripts/watcher-failure.ts",
    ],
    forbidden: ["node:", "./paths", "./bin", "./llm", "./config"],
  },
  {
    files: ["src/security/secureNotes.ts"],
    forbidden: ["react", "@tauri-apps/", "../ai/", "../components/", "../lib/tauri", "../state/"],
  },
  {
    // Slash commands are a Markdown-editor capability, never a document,
    // workbook, or generic-file capability.
    files: [
      "src/components/documentEditor.tsx",
      "src/components/fileSurface.tsx",
      "src/sheets/sheetEditor.tsx",
    ],
    forbidden: ["../editor/slash", "../../editor/slash"],
  },
];

const violations = [];

// Every source root and presentation cluster has an explicit owner. This closes
// the catch-all loophole where a new capability could land beside established
// features without choosing a boundary, and where components/ accumulated
// feature helpers that belonged together.
const sourceEntries = readdirSync(join(root, "src"), { withFileTypes: true });
const componentEntries = readdirSync(join(root, "src", "components"), { withFileTypes: true });
violations.push(
  ...sourceOwnershipViolations({
    sourceDirectories: sourceEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    sourceRootFiles: sourceEntries
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => entry.name),
    componentDirectories: componentEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    componentRootFiles: componentEntries
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => entry.name),
    serviceFiles: readdirSync(join(root, "src", "services"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      .map((entry) => entry.name),
  }),
);

// F7: a partial split (any role file or composition.ts without BOTH trigger
// files) gets no protection above — that state must be exempt-by-name, and an
// exemption must go stale loudly, never linger past a real split.
const partialSplitSignals = new Set([...cleanFeatureRoles, "composition.ts"]);
for (const entry of readdirSync(join(root, "src"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(root, "src", entry.name);
  const rel = `src/${entry.name}`;
  const hasTriggerPair = existsSync(join(dir, "workflow.ts")) && existsSync(join(dir, "composition.ts"));
  const hasRoleFile = readdirSync(dir).some((name) => partialSplitSignals.has(name));
  if (hasRoleFile && !hasTriggerPair && !(rel in cleanFeatureExemptions)) {
    violations.push(
      `${rel}: carries clean-feature role files without workflow.ts + composition.ts — add the full split or an exemption entry`,
    );
  }
  if (hasTriggerPair && rel in cleanFeatureExemptions) {
    violations.push(`${rel}: has the full clean-feature split — remove its stale exemption entry`);
  }
}
for (const dir of Object.keys(cleanFeatureExemptions)) {
  if (!existsSync(join(root, dir)))
    violations.push(`${dir}: exempt dir no longer exists — remove its exemption entry`);
}

function importsOf(source) {
  return [
    ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ...source.matchAll(/import\s+(["'])([^"']+)\1/g),
  ].map((match) => match[2]);
}

// lib is dependency-inward by default. The few cross-capability gesture and
// shell adapters are explicit, reasoned exceptions; an effectful import in any
// other lib file is a placement failure, and stale exceptions fail too. React
// type-only imports remain pure, while a runtime React import makes the module
// a presentation hook/adapter that must be named here as well.
const effectfulLibPrefixes = ["@tauri-apps/", "../memex/", "../newItems/", "../services/", "../state/"];
const libDir = join(root, "src", "lib");
const effectfulLibFiles = new Set();
for (const name of readdirSync(libDir)) {
  if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
  const source = readFileSync(join(libDir, name), "utf8");
  const imports = importsOf(source);
  const hasRuntimeReactImport = /import\s+(?!type\b)[\s\S]*?\sfrom\s+["']react["']/.test(source);
  if (
    !hasRuntimeReactImport &&
    !imports.some((dependency) => effectfulLibPrefixes.some((prefix) => dependency.startsWith(prefix)))
  ) {
    continue;
  }
  effectfulLibFiles.add(name);
  if (!(name in LIB_EFFECTFUL_FILE_OWNERS)) {
    violations.push(
      `src/lib/${name}: effectful cross-capability code needs a named owner or a services/ home`,
    );
  }
}
for (const name of Object.keys(LIB_EFFECTFUL_FILE_OWNERS)) {
  if (!effectfulLibFiles.has(name)) {
    violations.push(`src/lib/${name}: effectful-lib ownership entry is stale or the file is missing`);
  }
}

for (const layer of protectedLayers) {
  for (const file of layer.files) {
    const source = readFileSync(file, "utf8");
    const imports = importsOf(source);
    for (const dependency of imports) {
      if (layer.forbidden.some((prefix) => dependency === prefix || dependency.startsWith(prefix))) {
        violations.push(`${file}: forbidden dependency ${dependency}`);
      }
    }
  }
}

for (const dir of cleanFeatureDirs) {
  for (const [role, allowed] of Object.entries(allowedLocalRoleImports)) {
    const path = join(dir, role);
    if (!existsSync(path)) continue;
    const file = relative(root, path);
    const source = readFileSync(path, "utf8");
    const imports = importsOf(source);
    for (const dependency of imports) {
      if (
        dependency.startsWith("./") &&
        !allowed.some((prefix) => dependency === prefix || dependency.startsWith(`${prefix}/`))
      ) {
        violations.push(`${file}: ${role} may not depend outward on ${dependency}`);
      }
    }
  }
}

// Tauri is an adapter boundary. Three shell/composition files are intentionally
// allowed to touch it directly; all feature code uses the typed lib/tauri.ts
// façade so command names, browser fallbacks, and error normalization stay in
// one place.
// the shell plus the lib adapters that own a native seam (LIB_EFFECTFUL_FILE_OWNERS)
const tauriAllowlist = new Set([
  "src/app.tsx",
  "src/lib/chatWindowBridge.ts",
  "src/lib/clipboard.ts",
  "src/lib/nativeDrag.ts",
  "src/lib/quitFlush.ts",
  "src/lib/tauri.ts",
]);
function walkSource(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkSource(path);
    else if (/\.tsx?$/.test(name)) {
      const file = relative(root, path);
      if (tauriAllowlist.has(file)) continue;
      if (importsOf(readFileSync(path, "utf8")).some((dependency) => dependency.startsWith("@tauri-apps/"))) {
        violations.push(`${file}: Tauri APIs belong behind src/lib/tauri.ts`);
      }
    }
  }
}
walkSource(join(root, "src"));

// Vendor engines/codecs stay behind their adapters (ROTLI contract: "JSZip,
// Univer, ExcelJS, and canvas engines stay behind adapters"). Tests may reach
// vendors directly to build fixtures.
const vendorSeams = [
  { vendor: "exceljs", allowed: ["src/sheets/codec/", "src/sheets/engine/"] },
  { vendor: "@excalidraw/", allowed: ["src/boards/engine/", "src/app.tsx"] },
  {
    vendor: "@univerjs",
    allowed: ["src/sheets/engine/", "src/documents/engine/", "src/brand/univerTheme.ts"],
  },
  {
    vendor: "jszip",
    allowed: ["src/documents/codec/", "src/documents/create.ts", "src/sheets/codec/", "src/lib/vaultZip.ts"],
  },
];
function walkVendors(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkVendors(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      const file = relative(root, path);
      const imports = importsOf(readFileSync(path, "utf8"));
      for (const { vendor, allowed } of vendorSeams) {
        if (allowed.some((prefix) => file === prefix || file.startsWith(prefix))) continue;
        if (imports.some((dependency) => dependency === vendor || dependency.startsWith(vendor))) {
          violations.push(`${file}: ${vendor} belongs behind its adapter (${allowed.join(", ")})`);
        }
      }
    }
  }
}
walkVendors(join(root, "src"));

// Rust parser/vendor crates receive the same single-adapter protection. Cargo
// package names use hyphens while Rust paths use underscores.
const rustVendorSeams = [{ vendor: "pdf_extract", allowed: ["src-tauri/src/document_conversion.rs"] }];
function walkRustVendors(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkRustVendors(path);
    else if (name.endsWith(".rs")) {
      const file = relative(root, path);
      const source = readFileSync(path, "utf8");
      for (const { vendor, allowed } of rustVendorSeams) {
        if (allowed.includes(file)) continue;
        if (source.includes(`${vendor}::`)) {
          violations.push(`${file}: ${vendor} belongs behind its adapter (${allowed.join(", ")})`);
        }
      }
    }
  }
}
walkRustVendors(join(root, "src-tauri", "src"));

// Presentation reaches the Tauri adapter through services, not directly.
// ARCHITECTURE.md orders adapters -> composition -> presentation, but the
// component tree was never held to it: 27 components imported lib/tauri
// straight (audit 2026-09-01). The allowlist is the measured debt; it only
// shrinks (a listed file that stops importing must be removed here).
const componentAdapterDebt = new Set([
  "src/components/activitySurface.tsx",
  "src/components/breve/breveSurface.tsx",
  "src/components/breve/breveWatchlist.tsx",
  "src/components/breve/useBreve.ts",
  "src/components/browserSurface.tsx",
  "src/components/captureCard.tsx",
  "src/components/chat/chatSurface.tsx",
  "src/components/dashboardSurface.tsx",
  "src/components/documentEditor.tsx",
  "src/components/fileSurface.tsx",
  "src/components/modelUsageSummary.ts",
  "src/components/onboarding/modelSetup.tsx",
  "src/components/onboarding/onboarding.tsx",
  "src/components/onboarding/vaultActivation.tsx",
  "src/components/previewModal.tsx",
  "src/components/quickNote.tsx",
  "src/components/settingsSurface.tsx",
  "src/components/sidebar.tsx",
  "src/components/sidebar/sidebarChat.tsx",
  "src/components/sidebar/sidebarFooter.tsx",
  "src/components/sidebar/useChatFolders.ts",
  "src/components/systemSurface.tsx",
  "src/components/tasksSurface.tsx",
  "src/components/titlebar.tsx",
  "src/components/useNoteMenu.ts",
  "src/components/vaultFolderBrowserDialog.tsx",
]);
// Cross-cutting idioms with ONE owner each: the OS colour scheme is read only
// by the theme owner (everything else reads data-theme through state/theme.ts),
// and query invalidation is a services concern (hooks.ts owns the umbrellas).
const colourSchemeOwners = new Set(["src/state/systemScheme.ts", "src/state/theme.ts"]);
const invalidationDebt = new Set(["src/memex/useMemex.ts", "src/components/settingsSurface.tsx"]);
const seenComponentAdapterImports = new Set();
const seenInvalidationDebt = new Set();
function walkIdioms(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkIdioms(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      const file = relative(root, path);
      const source = readFileSync(path, "utf8");
      if (file.startsWith("src/components/") && importsOf(source).some((d) => /(^|\/)lib\/tauri$/.test(d))) {
        if (componentAdapterDebt.has(file)) seenComponentAdapterImports.add(file);
        else
          violations.push(
            `${file}: presentation imports lib/tauri directly — route through a services/ function (or extend componentAdapterDebt with a reason)`,
          );
      }
      if (/matchMedia\(\s*["'`]\(prefers-color-scheme/.test(source) && !colourSchemeOwners.has(file)) {
        violations.push(
          `${file}: reads prefers-color-scheme — use useIsDarkTheme/useDataTheme (state/theme.ts) or systemPrefersDark`,
        );
      }
      if (/\binvalidateQueries\(/.test(source) && !file.startsWith("src/services/")) {
        if (invalidationDebt.has(file)) seenInvalidationDebt.add(file);
        else
          violations.push(
            `${file}: raw invalidateQueries outside services/ — call the owning invalidate* helper in services/hooks.ts`,
          );
      }
    }
  }
}
walkIdioms(join(root, "src"));
for (const file of componentAdapterDebt) {
  if (!seenComponentAdapterImports.has(file))
    violations.push(
      `${file}: no longer imports lib/tauri — remove it from componentAdapterDebt (the list only shrinks)`,
    );
}
for (const file of invalidationDebt) {
  if (!seenInvalidationDebt.has(file))
    violations.push(`${file}: no longer calls invalidateQueries — remove it from invalidationDebt`);
}

if (violations.length) {
  console.error(`clean architecture boundary failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(
  `check:architecture ok — source roots, presentation clusters, services, and effectful lib adapters have owners; ${discoveredCleanFiles.length} clean-feature files point inward (${Object.keys(cleanFeatureExemptions).length} dirs exempt by name); Tauri stays behind its adapter`,
);
