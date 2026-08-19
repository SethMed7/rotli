// Shared editor block glyphs (the maintainer, 2026-06-30) — the SlashMenu and the
// FormatBar drew byte-identical bullet/numbered/checklist/quote/code marks in
// the same 24-box, 1.7-stroke, currentColor voice. This is their one home; each
// surface imports the marks it needs (and keeps its own surface-only glyphs).

import type { ReactNode } from "react";

/** The shared glyph frame: a 15px currentColor SVG in the editor's line voice. */
export function Gl({ children, strokeWidth }: { children: ReactNode; strokeWidth?: number }) {
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

export const bulletGlyph = (
  <Gl>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
  </Gl>
);
export const numberedGlyph = (
  <Gl strokeWidth={1.5}>
    <path d="M10 6h11M10 12h11M10 18h11M3 5.5 5 4v5M3.6 13.5a1.7 1.7 0 0 1 3 1c0 .8-.6 1.3-1.4 2L3.4 18H7" />
  </Gl>
);
export const checklistGlyph = (
  <Gl>
    <path d="M10 6h11M10 12h11M10 18h11" />
    <path d="m2.5 6 1.2 1.2L6 4.9M2.5 12l1.2 1.2L6 10.9M2.5 18l1.2 1.2L6 16.9" strokeWidth={1.6} />
  </Gl>
);
export const quoteGlyph = (
  <Gl>
    <path
      d="M3 21c3-1 4-3 4-6V9a3 3 0 0 1 3-3h0M14 21c3-1 4-3 4-6V9a3 3 0 0 1 3-3h0"
      transform="scale(0.9) translate(1,1)"
    />
  </Gl>
);
export const codeGlyph = (
  <Gl>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Gl>
);
