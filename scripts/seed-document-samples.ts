import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createDocxBase64, type DocxTemplate } from "../src/documents/create";

const replace = process.argv.includes("--replace");
const [outputDir, manifestPath, idPrefix = "storage/rotli"] = process.argv.slice(2).filter((arg) => arg !== "--replace");
if (!outputDir || !manifestPath) {
  throw new Error("usage: bun scripts/seed-document-samples.ts <output-dir> <dev-main.json> [id-prefix]");
}

const samples: Array<{ name: string; template: DocxTemplate }> = [
  {
    name: "rotli-document-workflow.docx",
    template: {
      title: "Rotli document workflow",
      subtitle: "A local DOCX sample for embedded viewing",
      blocks: [
        { kind: "heading", level: 2, text: "What to test" },
        { kind: "paragraph", text: "Embed this file with /Document, choose Zoom in, and confirm the current note and tab remain active." },
        { kind: "paragraph", text: "Choose Zoom out to return to the note, or Open in tab when you want a dedicated document surface." },
      ],
      table: [["Action", "Expected result"], ["Zoom in", "Document fills the note pane"], ["Zoom out", "Returns to the same note"], ["Open in tab", "Creates a separate document tab"]],
    },
  },
  {
    name: "project-brief-template.docx",
    template: {
      title: "Project brief template",
      subtitle: "A second DOCX for search and picker testing",
      blocks: [
        { kind: "heading", level: 2, text: "Objective" },
        { kind: "paragraph", text: "Describe the outcome, audience, and constraints." },
        { kind: "heading", level: 2, text: "Next steps" },
        { kind: "paragraph", text: "Assign an owner and due date for each decision." },
      ],
      table: [["Owner", "Decision", "Status"], ["Seth", "Review embedded workflow", "Ready"]],
    },
  },
];

await mkdir(outputDir, { recursive: true });
const ids: string[] = [];
for (const sample of samples) {
  const base64 = await createDocxBase64(sample.template);
  try {
    await writeFile(join(outputDir, sample.name), Buffer.from(base64, "base64"), replace ? undefined : { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  ids.push(`${idPrefix}/${sample.name}`);
}

type MainNode = { note: string } | { folder: string; children: MainNode[] };
let manifest: { version: 1; tree: MainNode[] } = { version: 1, tree: [] };
try {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as typeof manifest;
  if (parsed?.version === 1 && Array.isArray(parsed.tree)) manifest = parsed;
} catch {
  // A missing development manifest is the expected first-run state.
}

const includes = (nodes: MainNode[], id: string): boolean =>
  nodes.some((node) => ("note" in node ? node.note === id : includes(node.children, id)));
for (const id of ids) if (!includes(manifest.tree, id)) manifest.tree.push({ note: id });
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Seeded ${ids.length} DOCX samples and added them to development Main.`);
