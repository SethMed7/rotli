/** Stable item kinds used by every creation entry point and persisted setting. */
export const NEW_ITEM_KINDS = ["markdown", "document", "sheet", "board", "mermaid"] as const;

export type NewItemKind = (typeof NEW_ITEM_KINDS)[number];

export interface NewItemDefinition {
  kind: NewItemKind;
  label: string;
  description: string;
}

/** A kind the build withholds stays visible in the chooser as "coming soon";
 * every other entry point (menus, actions, Settings, persisted defaults) treats
 * it as absent. */
export type NewItemAvailability = "available" | "comingSoon";

export interface NewItemFeatures {
  sheets: boolean;
  mermaidDiagrams: boolean;
}

export function newItemAvailability(kind: NewItemKind, features: NewItemFeatures): NewItemAvailability {
  if (kind === "sheet" && !features.sheets) return "comingSoon";
  if (kind === "mermaid" && !features.mermaidDiagrams) return "comingSoon";
  return "available";
}

export function isNewItemAvailable(kind: NewItemKind, features: NewItemFeatures): boolean {
  return newItemAvailability(kind, features) === "available";
}

/** Definitions with their availability, in chooser order. */
export function newItemChoices(
  features: NewItemFeatures,
): (NewItemDefinition & { availability: NewItemAvailability })[] {
  return NEW_ITEM_DEFINITIONS.map((item) => ({
    ...item,
    availability: newItemAvailability(item.kind, features),
  }));
}

/** Only the kinds this build can create — menus, Settings, and actions. */
export function availableNewItems(features: NewItemFeatures): NewItemDefinition[] {
  return NEW_ITEM_DEFINITIONS.filter((item) => isNewItemAvailable(item.kind, features));
}

/** Parse a persisted ⌘T default: unknown or withheld kinds read as Markdown. */
export function newTabDefaultFrom(value: unknown, features: NewItemFeatures): NewItemKind {
  return isNewItemKind(value) ? availableNewTabDefault(value, features) : DEFAULT_NEW_ITEM_KIND;
}

/** A persisted default that names a withheld kind falls back to Markdown. */
export function availableNewTabDefault(kind: NewItemKind, features: NewItemFeatures): NewItemKind {
  return isNewItemAvailable(kind, features) ? kind : DEFAULT_NEW_ITEM_KIND;
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
