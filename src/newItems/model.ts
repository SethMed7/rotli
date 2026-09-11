/** Stable item kinds used by every creation entry point and persisted setting. */
export const NEW_ITEM_KINDS = ["markdown", "document", "sheet", "board", "mermaid"] as const;

export type NewItemKind = (typeof NEW_ITEM_KINDS)[number];

export interface NewItemDefinition {
  kind: NewItemKind;
  label: string;
  description: string;
}

/** One product vocabulary for menus, Settings, the palette, and tests. */
export const NEW_ITEM_DEFINITIONS: readonly NewItemDefinition[] = [
  {
    kind: "markdown",
    label: "Markdown note",
    description: "A flexible note with slash commands and embeds.",
  },
  {
    kind: "document",
    label: "Document",
    description: "A conventional DOCX document without Markdown embeds.",
  },
  {
    kind: "sheet",
    label: "Sheet",
    description: "An editable XLSX workbook.",
  },
  {
    kind: "board",
    label: "Board",
    description: "A freeform Excalidraw canvas.",
  },
  {
    kind: "mermaid",
    label: "Mermaid diagram",
    description: "A note born with a flowchart fence and its diagram workspace.",
  },
];

export const DEFAULT_NEW_ITEM_KIND: NewItemKind = "markdown";

export function isNewItemKind(value: unknown): value is NewItemKind {
  return typeof value === "string" && (NEW_ITEM_KINDS as readonly string[]).includes(value);
}

export function newItemDefinition(kind: NewItemKind): NewItemDefinition {
  return NEW_ITEM_DEFINITIONS.find((item) => item.kind === kind) ?? NEW_ITEM_DEFINITIONS[0]!;
}
