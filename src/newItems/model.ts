/** Stable item kinds used by every creation entry point and persisted setting. */
/** Chooser order; a new kind goes LAST so every earlier digit stays put. */
export const NEW_ITEM_KINDS = ["markdown", "document", "sheet", "board", "mermaid", "canvas"] as const;

export type NewItemKind = (typeof NEW_ITEM_KINDS)[number];

export interface NewItemDefinition {
  kind: NewItemKind;
  label: string;
  description: string;
  /** Ships, but still Beta: every surface that offers or opens it says so. */
  beta?: true;
}

/** Kinds whose filename IS their name, so the name is collected before the
 * file exists — cancelling leaves nothing behind. */
const NAME_FIRST_KINDS = ["board", "canvas", "document"] as const;
export type NameFirstKind = (typeof NAME_FIRST_KINDS)[number];

export function isNameFirstKind(kind: NewItemKind): kind is NameFirstKind {
  return (NAME_FIRST_KINDS as readonly NewItemKind[]).includes(kind);
}

/** A kind the build withholds stays visible in the chooser as "coming soon";
 * every other entry point (menus, actions, Settings, persisted defaults) treats
 * it as absent. */
export type NewItemAvailability = "available" | "comingSoon";

export interface NewItemFeatures {
  documents: boolean;
  sheets: boolean;
  mermaidDiagrams: boolean;
  jsonCanvas: boolean;
}

export function newItemAvailability(kind: NewItemKind, features: NewItemFeatures): NewItemAvailability {
  if (kind === "document" && !features.documents) return "comingSoon";
  if (kind === "sheet" && !features.sheets) return "comingSoon";
  if (kind === "mermaid" && !features.mermaidDiagrams) return "comingSoon";
  if (kind === "canvas" && !features.jsonCanvas) return "comingSoon";
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
    beta: true,
  },
  {
    kind: "sheet",
    label: "Sheet",
    description: "An editable XLSX workbook.",
    beta: true,
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
  {
    kind: "canvas",
    label: "Canvas",
    description: "Cards and notes on an open plane, saved as a JSON Canvas.",
  },
];

export const DEFAULT_NEW_ITEM_KIND: NewItemKind = "markdown";

export function isNewItemKind(value: unknown): value is NewItemKind {
  return typeof value === "string" && (NEW_ITEM_KINDS as readonly string[]).includes(value);
}

export function newItemDefinition(kind: NewItemKind): NewItemDefinition {
  return NEW_ITEM_DEFINITIONS.find((item) => item.kind === kind) ?? NEW_ITEM_DEFINITIONS[0]!;
}

/** The one Beta word, for surfaces that can only show text. */
export const BETA_LABEL = "Beta";

export function isBetaKind(kind: NewItemKind): boolean {
  return newItemDefinition(kind).beta === true;
}

/** "Sheet · Beta" — a menu row, a select option, a palette title. */
export function withBetaLabel(text: string, kind: NewItemKind): string {
  return isBetaKind(kind) ? `${text} · ${BETA_LABEL}` : text;
}

/** Files that open in a Beta editor: workbooks and CSV in the sheet editor,
 * DOCX in the document editor (both run on Univer). */
const EDITOR_KIND_BY_EXT: Readonly<Record<string, NewItemKind>> = {
  xlsx: "sheet",
  csv: "sheet",
  docx: "document",
};

export function isBetaFileExt(ext: string): boolean {
  const kind = EDITOR_KIND_BY_EXT[ext.toLowerCase()];
  return kind !== undefined && isBetaKind(kind);
}
