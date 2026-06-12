// Generic UI glyphs, collected from the approved gate frames' inline SVGs
// (r4/r5). These are chrome glyphs, not kit module icons — those live in the
// sprite and render via <Icon>.

import type { ReactNode } from "react";

interface GlyphProps {
  size?: number | undefined;
  className?: string | undefined;
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

/** Split-right palette row (r3 frame F). */
export function SplitGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </Glyph>
  );
}

/** Focus-mode corners (r3 frame F). */
export function FocusGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </Glyph>
  );
}

/** Settings → Hotkeys nav row (r1 frame F). */
export function KeyboardGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h10" />
    </Glyph>
  );
}

/** Settings → Appearance nav row (r1 frame F). */
export function SunGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Glyph>
  );
}

/** Settings → Storage nav row (r1 frame F). */
export function DatabaseGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5V12c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5" />
      <path d="M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12" />
    </Glyph>
  );
}

/** "This Mac" storage card (r1 frame F). */
export function LaptopGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="14" width="20" height="6" rx="2" />
      <path d="M6 14V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8" />
      <path d="M6 17h.01M10 17h.01" />
    </Glyph>
  );
}

/** Cloud storage cards (r1 frame F). */
export function CloudGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.7 3.8 3.8 0 0 0 6 20h11.5Z" />
    </Glyph>
  );
}

/** Active-storage check (r1 frame F; clay circle per the r2 clay-budget call). */
export function CheckGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="m4 12.5 5 5L20 6.5" />
    </Glyph>
  );
}
