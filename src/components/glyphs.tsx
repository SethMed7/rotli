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

/** Folder row (r1/r2 gates). */
export function FolderGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </Glyph>
  );
}

/** Note/file — "All notes" row + tab type glyph (r1/r2 gates). */
export function FileGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </Glyph>
  );
}

/** "Recent" row (r1/r2 gates). */
export function ClockGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Glyph>
  );
}

/** New folder / new tab (r1/r2 gates). */
export function PlusGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

/** Filter field magnifier (r2 gate). */
export function SearchGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Glyph>
  );
}

/** Tab close (r2 gate). */
export function XGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Glyph>
  );
}

/** New-note pencil (r1/r2 gates). */
export function PencilGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Glyph>
  );
}

/** Pinned marker in the note meta line (r2 gate). */
export function PinGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 17v5M9 10.8 5 15h14l-4-4.2V5l1.5-2h-9L9 5Z" />
    </Glyph>
  );
}
