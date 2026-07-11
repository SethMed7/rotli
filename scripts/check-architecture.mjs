import { readFileSync } from "node:fs";

const protectedLayers = [
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
      "src/components/documentPreview.tsx",
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

if (violations.length) {
  console.error(`clean architecture boundary failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log("check:architecture ok — domain and application layers point inward");
