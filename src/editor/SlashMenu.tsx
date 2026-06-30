// The "/" slash menu (Seth 2026-06-13): type "/" at the start of an empty
// active line in the editor to insert a block. A LOCAL editor affordance, not
// a global key surface — EditorSurface owns the open/query/index state and
// drives this purely as a presentational popover anchored under the active row
// (anchorRef = rawRowRef). Each item carries a STRUCTURED op (heading/block/
// code); EditorSurface clears the "/query" and applies it to the now-empty line
// via the canonical applyHeading/applyBlockToggle — never through the stale
// activeEditor() handle (which would compose "- /bul" instead of "- ").
//
// We mirror the format bar's popover grammar (the .fbmenu/.fbrow voice) but in
// a dedicated .slashmenu block (positioned under, not above, the anchor) so the
// two surfaces can evolve independently. Glyphs are reused from FormatBar's
// vocabulary — same SVG voice, same 15px size.

import type { ReactNode } from "react";
import type { BlockToggle } from "./commands";
import { bulletGlyph, checklistGlyph, codeGlyph, numberedGlyph, quoteGlyph } from "./formatGlyphs";

// "H1/2/3" read as text glyphs (matches the format bar's H affordance voice)
function Heading({ level }: { level: 1 | 2 | 3 }) {
  return <span className="slashglyph-h">{`H${level}`}</span>;
}

// Each item names its glyph + label and a STRUCTURED op EditorSurface applies to
// the cleared line. NOTE: there is no fenced code-block primitive in Stage 1 —
// "Code" inserts inline backticks (caret between the ticks); the label stays "Code".
export type SlashOp =
  | { kind: "heading"; level: 1 | 2 | 3 }
  | { kind: "block"; block: BlockToggle }
  | { kind: "code" };

export interface SlashItem {
  label: string;
  glyph: ReactNode;
  op: SlashOp;
}

export const SLASH_ITEMS: SlashItem[] = [
  { label: "Heading 1", glyph: <Heading level={1} />, op: { kind: "heading", level: 1 } },
  { label: "Heading 2", glyph: <Heading level={2} />, op: { kind: "heading", level: 2 } },
  { label: "Heading 3", glyph: <Heading level={3} />, op: { kind: "heading", level: 3 } },
  { label: "Bullet", glyph: bulletGlyph, op: { kind: "block", block: "bullet" } },
  { label: "Numbered", glyph: numberedGlyph, op: { kind: "block", block: "numbered" } },
  { label: "Checklist", glyph: checklistGlyph, op: { kind: "block", block: "checklist" } },
  { label: "Quote", glyph: quoteGlyph, op: { kind: "block", block: "quote" } },
  { label: "Code", glyph: codeGlyph, op: { kind: "code" } },
];

/** Filter by an includes-match on the label (case-insensitive). Exported so
 * EditorSurface can keep its slashIndex inside the same filtered set. */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return SLASH_ITEMS;
  return SLASH_ITEMS.filter((it) => it.label.toLowerCase().includes(q));
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
  if (items.length === 0) return null;

  return (
    <div className="slashmenu" role="menu" aria-label="Insert block">
      {items.map((item, i) => (
        <button
          type="button"
          key={item.label}
          className={i === selectedIndex ? "slashrow sel" : "slashrow"}
          role="menuitem"
          // keep the textarea focused — picking must never end the edit
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(item)}
        >
          <span className="slashglyph">{item.glyph}</span>
          <span className="slashlabel">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
