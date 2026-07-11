import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

// Any feature with workflow.ts + composition.ts opts into the clean-feature
// convention automatically. New model/ports/retrieval/workflow files in that
// feature are protected without editing this script.
const cleanFeatureRoles = new Set(["model.ts", "ports.ts", "retrieval.ts", "workflow.ts"]);
const discoveredCleanFiles = readdirSync(join(root, "src"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, "src", entry.name))
  .filter((dir) => existsSync(join(dir, "workflow.ts")) && existsSync(join(dir, "composition.ts")))
  .flatMap((dir) => readdirSync(dir)
    .filter((name) => cleanFeatureRoles.has(name))
    .map((name) => relative(root, join(dir, name))));

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
    files: [
      "src/documents/model.ts",
      "src/documents/ports.ts",
      "src/documents/workflow.ts",
    ],
    forbidden: [
      "react",
      "@tauri-apps/",
      "../components/",
      "../lib/tauri",
      "./composition",
      "./create",
      "./preview",
    ],
  },
  {
    files: ["src/newItems/model.ts", "src/newItems/workflow.ts"],
    forbidden: [
      "react",
      "@tauri-apps/",
      "../components/",
      "../lib/tauri",
      "../state/",
      "./composition",
      "./menu",
    ],
  },
  {
    files: [
      "src/chatMemory/model.ts",
      "src/chatMemory/retrieval.ts",
      "src/chatMemory/workflow.ts",
    ],
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
for (const layer of protectedLayers) {
  for (const file of layer.files) {
    const source = readFileSync(file, "utf8");
    const imports = [
      ...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g),
    ].map((match) => match[2]);
    for (const dependency of imports) {
      if (layer.forbidden.some((prefix) => dependency === prefix || dependency.startsWith(prefix))) {
        violations.push(`${file}: forbidden dependency ${dependency}`);
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
      if (/from\s+["']@tauri-apps\//.test(readFileSync(path, "utf8"))) {
        violations.push(`${file}: Tauri APIs belong behind src/lib/tauri.ts`);
      }
    }
  }
}
walkSource(join(root, "src"));

if (violations.length) {
  console.error(`clean architecture boundary failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:architecture ok — ${discoveredCleanFiles.length} clean-feature files point inward; Tauri stays behind its adapter`);
