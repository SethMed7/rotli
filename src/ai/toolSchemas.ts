// Rotli's chat tools as native tool definitions (name, description, JSON
// schema) for Claude's agent protocol. The JSON loop describes the same tools
// inline in its prompt (prompt.ts); runTool (tools.ts) executes both.

import type { NativeToolSpec } from "../lib/claudeSession";
import type { ToolName } from "./types";

const text = (description: string) => ({ type: "string", description });
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const SPECS: Partial<Record<ToolName, Omit<NativeToolSpec, "name">>> = {
  search_memory: {
    description:
      "Search the user's master memory: their notes and prior chats. Use one short, distinctive keyword.",
    inputSchema: object({ query: text("one distinctive keyword") }, ["query"]),
  },
  read_memory: {
    description: "Read the exact note or chat a search_memory hit returned.",
    inputSchema: object({ id: text("the id from search_memory") }, ["id"]),
  },
  search_notes: {
    description:
      "Find the user's notes by exact substring. Returns id, title, folder, snippet, and a role where one applies.",
    inputSchema: object({ query: text("one distinctive keyword") }, ["query"]),
  },
  read_note: {
    description: "Read one note's full text by id.",
    inputSchema: object({ id: text("the note id") }, ["id"]),
  },
  create_note: {
    description: "Create a NEW Markdown note in the user's vault; it lands in their intake.",
    inputSchema: object({ title: text("the note title"), body: text("the note body, in Markdown") }, [
      "title",
      "body",
    ]),
  },
  update_note: {
    description:
      "Rewrite an existing note. Read it first; the body you send replaces everything, so send the complete new Markdown.",
    inputSchema: object({ id: text("the note id"), body: text("the COMPLETE new Markdown body") }, [
      "id",
      "body",
    ]),
  },
  open_note: {
    description: "Open a note on the user's screen, in a tab.",
    inputSchema: object({ id: text("the note id") }, ["id"]),
  },
  read_file: {
    description:
      "Read a file from the vault by name: text as itself, a CSV as CSV, an .xlsx as every cell by its A1 address (formulas with their results), and a Word document as numbered blocks (headings, list items, table cells r1c1…).",
    inputSchema: object({ query: text("the file name or path, e.g. report.csv") }, ["query"]),
  },
  web_search: {
    description: "Search the public web. Results carry numbered source ids, like [S1].",
    inputSchema: object({ query: text("the search query") }, ["query"]),
  },
  web_fetch: {
    description:
      "Read one web page as text. A page drawn by JavaScript comes back as a note saying only its shell was read.",
    inputSchema: object({ url: text("an http(s) URL") }, ["url"]),
  },
  generate_image: {
    description: "Create an image, saved into this chat's assets. Describe the image, never a file path.",
    inputSchema: object({ prompt: text("what the image shows") }, ["prompt"]),
  },
  create_document: {
    description:
      "Create an editable Word document (.docx), file it through Rotli, and show it beside this chat. Headings, paragraphs, lists, and one table; no Markdown image embeds.",
    inputSchema: object(
      { title: text("the document title"), body: text("structured Markdown-like content") },
      ["title", "body"],
    ),
  },
  edit_document: {
    description:
      "Edit a Word document Rotli's AI created (read it first with read_file; Rotli refuses one the user made). Actions use read_file's block numbers, which keep meaning the document as read: replace {block,text}, insert_after {block (0 = top), kind, text}, delete {block}, set_cell {block,row,column,text}, set_kind {block,kind}. Kinds: paragraph, heading1, heading2, heading3, title, bullet, number.",
    inputSchema: object(
      {
        file: text("the document's file name, e.g. plan.docx"),
        actions: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["replace", "insert_after", "delete", "set_cell", "set_kind"] },
              block: { type: "integer", minimum: 0 },
              text: { type: "string" },
              kind: {
                type: "string",
                enum: ["paragraph", "heading1", "heading2", "heading3", "title", "bullet", "number"],
              },
              row: { type: "integer", minimum: 1 },
              column: { type: "integer", minimum: 1 },
            },
            required: ["op", "block"],
            additionalProperties: false,
          },
        },
      },
      ["file", "actions"],
    ),
  },
  create_artifact: {
    description:
      "Create a user-owned work file: an editable sheet (CSV with a header row) or a PDF with an editable Markdown source. Use create_document for Word files.",
    inputSchema: object(
      {
        kind: { type: "string", enum: ["sheet", "pdf"] },
        title: text("the file title"),
        content: text("CSV for a sheet, Markdown for a PDF"),
      },
      ["kind", "title", "content"],
    ),
  },
  draw_board: {
    description:
      "Turn a simple Mermaid flowchart (named nodes, arrows, short labels, one direction) into an editable visual board.",
    inputSchema: object(
      { title: text("the board title"), mermaid: text("a Mermaid flowchart, e.g. flowchart TD; A --> B") },
      ["title", "mermaid"],
    ),
  },
};

/** Native definitions for exactly the tools this turn allows, in a stable order. */
export function toolSpecsFor(allowed: ReadonlySet<ToolName>): NativeToolSpec[] {
  return [...allowed].flatMap((name) => {
    const spec = SPECS[name];
    return spec ? [{ name, ...spec }] : [];
  });
}
