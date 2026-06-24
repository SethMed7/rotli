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

// — glyphs (mirrors FormatBar's Gl voice: 24-box, 1.7 stroke, currentColor) —
function Gl({ children, strokeWidth }: { children: ReactNode; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// "H1/2/3" read as text glyphs (matches the format bar's H affordance voice)
function Heading({ level }: { level: 1 | 2 | 3 }) {
  return <span className="slashglyph-h">{`H${level}`}</span>;
}
const bulletGlyph = (
  <Gl>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
  </Gl>
);
const numberedGlyph = (
  <Gl strokeWidth={1.5}>
    <path d="M10 6h11M10 12h11M10 18h11M3 5.5 5 4v5M3.6 13.5a1.7 1.7 0 0 1 3 1c0 .8-.6 1.3-1.4 2L3.4 18H7" />
  </Gl>
);
const checklistGlyph = (
  <Gl>
    <path d="M10 6h11M10 12h11M10 18h11" />
    <path d="m2.5 6 1.2 1.2L6 4.9M2.5 12l1.2 1.2L6 10.9M2.5 18l1.2 1.2L6 16.9" strokeWidth={1.6} />
  </Gl>
);
const quoteGlyph = (
  <Gl>
    <path
      d="M3 21c3-1 4-3 4-6V9a3 3 0 0 1 3-3h0M14 21c3-1 4-3 4-6V9a3 3 0 0 1 3-3h0"
      transform="scale(0.9) translate(1,1)"
    />
  </Gl>
);
const codeGlyph = (
  <Gl>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Gl>
);

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
