import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

// Any feature with workflow.ts + composition.ts opts into the clean-feature
// convention automatically. New model/ports/retrieval/workflow files in that
// feature are protected without editing this script.
const cleanFeatureRoles = new Set(["model.ts", "ports.ts", "retrieval.ts", "workflow.ts"]);
const cleanFeatureDirs = readdirSync(join(root, "src"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, "src", entry.name))
  .filter((dir) => existsSync(join(dir, "workflow.ts")) && existsSync(join(dir, "composition.ts")));
const discoveredCleanFiles = cleanFeatureDirs.flatMap((dir) => readdirSync(dir)
    .filter((name) => cleanFeatureRoles.has(name))
    .map((name) => relative(root, join(dir, name))));

const allowedLocalRoleImports = {
  "model.ts": [],
  "ports.ts": ["./model"],
  "retrieval.ts": ["./model", "./ports"],
  "workflow.ts": ["./model", "./ports", "./retrieval"],
};

const protectedLayers = [
  {
    files: discoveredCleanFiles,
    forbidden: [
      "react",
      "@tauri-apps/",
      "../components/",
      "../lib/tauri",
      "../state/",
      "./composition",
    ],
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
    forbidden: [
      "react",
      "@tauri-apps/",
      "../ai/",
      "../components/",
      "../lib/tauri",
      "../state/",
    ],
  },
  {
    files: [
      "breve-runtime/scripts/brief-retention.ts",
      "breve-runtime/scripts/doctor-findings.ts",
      "breve-runtime/scripts/intents.ts",
      "breve-runtime/scripts/scheduler-core.ts",
      "breve-runtime/scripts/watcherFailure.ts",
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
function importsOf(source) {
  return [
    ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ...source.matchAll(/import\s+(["'])([^"']+)\1/g),
  ].map((match) => match[2]);
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
      if (dependency.startsWith("./") && !allowed.some(
        (prefix) => dependency === prefix || dependency.startsWith(`${prefix}/`),
      )) {
        violations.push(`${file}: ${role} may not depend outward on ${dependency}`);
      }
    }
  }
}

// Tauri is an adapter boundary. Three shell/composition files are intentionally
// allowed to touch it directly; all feature code uses the typed lib/tauri.ts
// façade so command names, browser fallbacks, and error normalization stay in
// one place.
const tauriAllowlist = new Set([
  "src/app.tsx",
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
  { vendor: "@univerjs", allowed: ["src/sheets/engine/", "src/documents/engine/", "src/brand/univerTheme.ts"] },
  { vendor: "jszip", allowed: ["src/documents/codec/", "src/documents/create.ts"] },
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

if (violations.length) {
  console.error(`clean architecture boundary failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:architecture ok — ${discoveredCleanFiles.length} clean-feature files point inward; ports and pure policies stay adapter-free; Tauri stays behind its adapter`);
