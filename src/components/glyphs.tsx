// Generic UI glyphs, collected from the approved gate frames' inline SVGs
// (r4/r5). These are chrome glyphs, not kit module icons — those live in the
// sprite and render via <Icon>.

import type { ReactNode } from "react";

interface GlyphProps {
  size?: number;
  className?: string;
}

function Glyph({ size = 15, className, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ChevronDown({ size = 10, className }: GlyphProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="m6 9 6 6 6-6" />
    </Glyph>
  );
}

/** Folders-rail toggle (r4 gate). */
export function RailFolders(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16" />
    </Glyph>
  );
}

/** Note-list toggle (r4 gate). */
export function RailList(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9.5 4v16M9.5 9h11.5M9.5 14h11.5" />
    </Glyph>
  );
}
