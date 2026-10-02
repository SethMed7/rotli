// The slash menu's alignment commands (alignedLine.ts has the grammar): each
// starts an aligned paragraph with the caret inside it. Left is the default,
// so it has no slash command; the palette's Align left removes the tags.

import { Gl } from "./formatGlyphs";
import type { SlashItem } from "./slashTypes";

const centerGlyph = (
  <Gl>
    <path d="M4 6h16M7 12h10M5 18h14" />
  </Gl>
);
const rightGlyph = (
  <Gl>
    <path d="M4 6h16M10 12h10M7 18h13" />
  </Gl>
);

export const ALIGN_SLASH_ITEMS: SlashItem[] = [
  {
    label: "Center",
    group: "Text",
    hint: "A centered paragraph",
    glyph: centerGlyph,
    op: { kind: "align", align: "center" },
    keywords: ["align", "centre", "middle"],
  },
  {
    label: "Align right",
    group: "Text",
    hint: "A right-aligned paragraph",
    glyph: rightGlyph,
    op: { kind: "align", align: "right" },
    keywords: ["align", "right"],
  },
];
