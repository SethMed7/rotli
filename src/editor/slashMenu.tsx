// The "/" slash menu (Seth 2026-06-13): type "/" at the start of an empty
// active line in the editor to insert a block. A LOCAL editor affordance, not
// a global key surface — CmEditor owns the open/query/index state and drives
// this purely as a presentational popover anchored under the active row. Each
// item carries a STRUCTURED op (heading/block/code/picker); CmEditor clears
// the "/query" and applies it to the now-empty line via the canonical
// applyHeading/applyBlockToggle — never through the stale activeEditor() handle.
//
// We mirror the format bar's popover grammar (the .fbmenu/.fbrow voice) but in
// a dedicated .slashmenu block (positioned under, not above, the anchor) so the
// two surfaces can evolve independently. Glyphs are reused from FormatBar's
// vocabulary — same SVG voice, same 15px size.

import type { ReactNode } from "react";
import { DOCUMENT_SEARCH_KEYWORDS } from "../documents/kinds";
import type { BlockToggle } from "./commands";
import { bulletGlyph, checklistGlyph, codeGlyph, numberedGlyph, quoteGlyph } from "./formatGlyphs";

// "H1/2/3" read as text glyphs (matches the format bar's H affordance voice)
function Heading({ level }: { level: 1 | 2 | 3 }) {
  return <span className="slashglyph-h">{`H${level}`}</span>;
}

// Each item names its glyph + label and a STRUCTURED op the editor applies to
// the cleared line: headings/blocks reuse the canonical line transforms, "code"
// stays the inline-backticks primitive, and the multi-line kinds (table /
// divider / fences) insert their scaffold with the caret placed inside
// (CmEditor's pickSlash owns the caret math).
export type SlashPickerMode = "linkNote" | "embedBoard" | "embedSheet" | "embedDocument";

export type SlashOp =
  | { kind: "heading"; level: 1 | 2 | 3 }
  | { kind: "block"; block: BlockToggle }
  | { kind: "code" }
  | { kind: "table" }
  | { kind: "divider" }
  | { kind: "fence"; lang: "" | "math" | "mermaid" }
  | { kind: "picker"; mode: SlashPickerMode };

export interface SlashItem {
  label: string;
  /** The Crepe-style section header this item files under. */
  group: "Text" | "List" | "Insert" | "Link";
  /** A muted one-line description (keeps the menu self-teaching). */
  hint: string;
  glyph: ReactNode;
  op: SlashOp;
  /** Extra filter tokens (note, wiki, excalidraw, …). */
  keywords?: string[];
}

// a minimal grid mark for Table + a thin rule for Divider (the shared Gl voice)
const tableGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M9.5 9.5V20M15.5 9.5V20" />
  </svg>
);
const dividerGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M3 12h18" />
    <path d="M7 5h10M7 19h10" opacity="0.35" />
  </svg>
);
const mathGlyph = <span className="slashglyph-h">∑</span>;
const mermaidGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="6" rx="1.5" />
    <rect x="14" y="15" width="7" height="6" rx="1.5" />
    <path d="M6.5 9v4a2 2 0 0 0 2 2h5.5" />
  </svg>
);

const linkGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const boardGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M8 12h8M12 8v8" opacity="0.45" />
  </svg>
);
const sheetGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M9.5 9.5V20M15.5 9.5V20" />
  </svg>
);
const documentGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v5h5M9 12h6M9 16h6" />
  </svg>
);

export const SLASH_ITEMS: SlashItem[] = [
  {
    label: "Heading 1",
    group: "Text",
    hint: "Big section heading",
    glyph: <Heading level={1} />,
    op: { kind: "heading", level: 1 },
  },
  {
    label: "Heading 2",
    group: "Text",
    hint: "Medium heading",
    glyph: <Heading level={2} />,
    op: { kind: "heading", level: 2 },
  },
  {
    label: "Heading 3",
    group: "Text",
    hint: "Small heading",
    glyph: <Heading level={3} />,
    op: { kind: "heading", level: 3 },
  },
  {
    label: "Quote",
    group: "Text",
    hint: "Pulled-aside passage",
    glyph: quoteGlyph,
    op: { kind: "block", block: "quote" },
  },
  {
    label: "Bullet",
    group: "List",
    hint: "Plain bulleted list",
    glyph: bulletGlyph,
    op: { kind: "block", block: "bullet" },
  },
  {
    label: "Numbered",
    group: "List",
    hint: "Ordered list",
    glyph: numberedGlyph,
    op: { kind: "block", block: "numbered" },
  },
  {
    label: "Checklist",
    group: "List",
    hint: "Tasks with checkboxes",
    glyph: checklistGlyph,
    op: { kind: "block", block: "checklist" },
  },
  {
    label: "Table",
    group: "Insert",
    hint: "3×2 grid, Tab hops cells",
    glyph: tableGlyph,
    op: { kind: "table" },
  },
  {
    label: "Divider",
    group: "Insert",
    hint: "Horizontal rule",
    glyph: dividerGlyph,
    op: { kind: "divider" },
  },
  {
    label: "Code block",
    group: "Insert",
    hint: "Fenced code",
    glyph: codeGlyph,
    op: { kind: "fence", lang: "" },
  },
  {
    label: "Inline code",
    group: "Insert",
    hint: "Code inside a sentence",
    glyph: codeGlyph,
    op: { kind: "code" },
  },
  {
    label: "Math",
    group: "Insert",
    hint: "KaTeX block",
    glyph: mathGlyph,
    op: { kind: "fence", lang: "math" },
  },
  {
    label: "Mermaid",
    group: "Insert",
    hint: "Interactive diagram",
    glyph: mermaidGlyph,
    op: { kind: "fence", lang: "mermaid" },
    keywords: ["diagram", "flowchart", "graph"],
  },
  {
    label: "Link note",
    group: "Link",
    hint: "Wikilink to another note",
    glyph: linkGlyph,
    op: { kind: "picker", mode: "linkNote" },
    keywords: ["note", "wiki", "link"],
  },
  {
    label: "Board",
    group: "Insert",
    hint: "Embed Excalidraw",
    glyph: boardGlyph,
    op: { kind: "picker", mode: "embedBoard" },
    keywords: ["excalidraw", "canvas", "draw"],
  },
  {
    label: "Sheet",
    group: "Insert",
    hint: "Embed spreadsheet",
    glyph: sheetGlyph,
    op: { kind: "picker", mode: "embedSheet" },
    keywords: ["xlsx", "csv", "spreadsheet", "excel"],
  },
  {
    label: "Document",
    group: "Insert",
    hint: "Create or embed editable DOCX",
    glyph: documentGlyph,
    op: { kind: "picker", mode: "embedDocument" },
    keywords: [...DOCUMENT_SEARCH_KEYWORDS],
  },
];

/** How much room a slash popover wants below the caret row before it prefers
 * flipping upward — roughly the menu's comfortable height. */
export const SLASH_FLIP_THRESHOLD = 300;

/** Popover direction: downward by default; flip up only when the space below
 * can't fit the menu AND above has more room (a short Quick Note window used
 * to clip the menu at its bottom edge — reading as "slash doesn't work"). */
export function slashPlacement(
  spaceAbove: number,
  spaceBelow: number,
  needed = SLASH_FLIP_THRESHOLD,
): "up" | "down" {
  return spaceBelow < needed && spaceAbove > spaceBelow ? "up" : "down";
}

/** Filter by label or optional keywords (case-insensitive). */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (it) => it.label.toLowerCase().includes(q) || it.keywords?.some((k) => k.includes(q)),
  );
}

/** A slash command owns the line only while the caret trails a slash-only query. */
export function slashQueryAtCaret(line: string, caret: number): string | null {
  if (caret !== line.length) return null;
  return /^\/([^/]*)$/.exec(line)?.[1] ?? null;
}

export function SlashMenu({
  query,
  selectedIndex,
  onHover,
  onPick,
}: {
  query: string;
  selectedIndex: number;
  onHover(index: number): void;
  onPick(item: SlashItem): void;
}) {
  const items = filterSlashItems(query);
  return (
    <div className="slashmenu" role="menu" aria-label="Insert block">
      {items.length === 0 && (
        <div className="slashmenu-empty" role="status">
          No commands found <span>Esc to close</span>
        </div>
      )}
      {items.map((item, i) => (
        <div key={item.label} className="slashgrouped">
          {item.group !== items[i - 1]?.group && (
            <div className="slashgroup" aria-hidden="true">
              {item.group}
            </div>
          )}
          <button
            type="button"
            className={i === selectedIndex ? "slashrow sel" : "slashrow"}
            role="menuitem"
            // keep the editor focused — picking must never end the edit
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(item)}
          >
            <span className="slashglyph">{item.glyph}</span>
            <span className="slashlabel">{item.label}</span>
            <span className="slashhint">{item.hint}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
