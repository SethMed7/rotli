// The AI's edits to a Word document (docs/design/univer-ai-integration.md):
// a bounded list of actions over the document model, addressed by the block
// numbers the model read (`editableDocumentForAi`). Pure; the codec saves the
// result, keeping every part of the file these actions don't touch.

import {
  type DocumentContent,
  type DocumentNamedStyle,
  type DocumentParagraph,
  type EditableDocument,
  runsWithLinks,
} from "./model";

export type BlockKind = "paragraph" | "heading1" | "heading2" | "heading3" | "title" | "bullet" | "number";

export type DocumentEditAction =
  | { op: "replace"; block: number; text: string }
  | { op: "insert_after"; block: number; kind: BlockKind; text: string }
  | { op: "delete"; block: number }
  | { op: "set_cell"; block: number; row: number; column: number; text: string }
  | { op: "set_kind"; block: number; kind: BlockKind };

export const MAX_EDIT_ACTIONS = 40;
export const MAX_EDIT_TEXT = 8000;
const KINDS: readonly BlockKind[] = [
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "title",
  "bullet",
  "number",
];

/** A model's argument as an action, or why it isn't one. */
export function parseEditAction(value: unknown): DocumentEditAction | string {
  if (!value || typeof value !== "object") return "each action is an object";
  const raw = value as Record<string, unknown>;
  const block = raw.block;
  if (typeof block !== "number" || !Number.isInteger(block) || block < 0)
    return "each action names a block number from read_file (0 inserts at the top)";
  const text = typeof raw.text === "string" ? raw.text : null;
  if (text !== null && text.length > MAX_EDIT_TEXT) return `keep each text under ${MAX_EDIT_TEXT} characters`;
  const kind = KINDS.includes(raw.kind as BlockKind) ? (raw.kind as BlockKind) : null;
  switch (raw.op) {
    case "replace":
      return text === null || block === 0
        ? "replace needs a block and its new text"
        : { op: "replace", block, text };
    case "insert_after":
      return text === null
        ? "insert_after needs text"
        : { op: "insert_after", block, kind: kind ?? "paragraph", text };
    case "delete":
      return block === 0 ? "delete needs a block" : { op: "delete", block };
    case "set_kind":
      return kind === null || block === 0
        ? `set_kind needs one of: ${KINDS.join(", ")}`
        : { op: "set_kind", block, kind };
    case "set_cell": {
      const { row, column } = raw;
      const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 1;
      if (!whole(row) || !whole(column) || text === null)
        return "set_cell needs a table block, row, column, and text";
      return { op: "set_cell", block, row: row as number, column: column as number, text };
    }
    default:
      return "op is one of: replace, insert_after, delete, set_cell, set_kind";
  }
}

function asParagraph(kind: BlockKind, text: string, base?: DocumentParagraph): DocumentParagraph {
  const style = base?.runs[0]?.style;
  const named: DocumentNamedStyle | undefined =
    kind === "paragraph" || kind === "bullet" || kind === "number" ? undefined : kind;
  return {
    runs: runsWithLinks(text).map((run) => (style ? { ...run, style } : run)),
    ...(named ? { namedStyle: named } : {}),
    ...(kind === "bullet" || kind === "number" ? { list: kind } : {}),
    ...(base?.alignment ? { alignment: base.alignment } : {}),
  };
}

/** A paragraph's text as the AI reads it: links as `[label](url)`. */
export function linkedText(paragraph: DocumentParagraph): string {
  return paragraph.runs.map((run) => (run.link ? `[${run.text}](${run.link})` : run.text)).join("");
}

function kindOf(paragraph: DocumentParagraph): BlockKind {
  if (paragraph.namedStyle && paragraph.namedStyle !== "normal" && paragraph.namedStyle !== "subtitle")
    return paragraph.namedStyle;
  return paragraph.list ?? "paragraph";
}

/** The document after the actions, or the first reason one can't apply. Block
 * numbers always mean the document as it was read, whatever came before. */
export function applyDocumentEdits(
  document: EditableDocument,
  actions: readonly DocumentEditAction[],
): EditableDocument | string {
  if (actions.length === 0) return "no actions to apply";
  if (actions.length > MAX_EDIT_ACTIONS) return `at most ${MAX_EDIT_ACTIONS} actions at once`;
  // each entry remembers its block number as read (null: inserted now)
  const blocks: { read: number | null; content: DocumentContent | null }[] = document.content.map(
    (content, i) => ({
      read: i + 1,
      content,
    }),
  );
  const find = (block: number) => blocks.findIndex((entry) => entry.read === block && entry.content !== null);
  for (const action of actions) {
    if (action.op === "insert_after") {
      const at = action.block === 0 ? -1 : find(action.block);
      if (action.block !== 0 && at < 0) return `there is no block ${action.block}`;
      const base = action.block === 0 ? undefined : blocks[at]?.content;
      const paragraph = asParagraph(
        action.kind,
        action.text,
        base?.kind === "paragraph" ? base.paragraph : undefined,
      );
      // after the block and anything already inserted after it
      let place = at + 1;
      while (place < blocks.length && blocks[place]?.read === null) place++;
      blocks.splice(place, 0, { read: null, content: { kind: "paragraph", paragraph } });
      continue;
    }
    const at = find(action.block);
    const entry = blocks[at];
    if (at < 0 || !entry?.content) return `there is no block ${action.block}`;
    const content = entry.content;
    if (action.op === "delete") {
      entry.content = null;
    } else if (action.op === "set_cell") {
      if (content.kind !== "table") return `block ${action.block} isn't a table`;
      const row = content.table.rows[action.row - 1];
      const cell = row?.cells[action.column - 1];
      if (!row || !cell) return `table ${action.block} has no cell r${action.row}c${action.column}`;
      const first = cell.paragraphs[0];
      const cells = row.cells.map((other, c) =>
        c === action.column - 1
          ? { ...other, paragraphs: [asParagraph(first ? kindOf(first) : "paragraph", action.text, first)] }
          : other,
      );
      const rows = content.table.rows.map((other, r) => (r === action.row - 1 ? { ...other, cells } : other));
      entry.content = { kind: "table", table: { ...content.table, rows } };
    } else {
      if (content.kind !== "paragraph")
        return `block ${action.block} is a ${content.kind}; only paragraphs take text and kinds`;
      entry.content = {
        kind: "paragraph",
        paragraph:
          action.op === "replace"
            ? asParagraph(kindOf(content.paragraph), action.text, content.paragraph)
            : asParagraph(action.kind, linkedText(content.paragraph), content.paragraph),
      };
    }
  }
  return {
    ...document,
    content: blocks.flatMap((entry) => (entry.content ? [entry.content] : [])),
  };
}
