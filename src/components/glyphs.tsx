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

/** Sidebar row disclosure caret — points right when collapsed, the .open class
 * rotates it down (Seth, 2026-06-13: one chevron for every expandable row). */
export function ChevronRight({ size = 10, className }: GlyphProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="m9 6 6 6-6 6" />
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

/** Vault — a book (the external knowledge base the Vault row browses). Reads as a
 * "knowledge collection," not a brain, matching the renamed destination. */
export function VaultGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3" />
    </Glyph>
  );
}

/** Excalidraw board — a canvas frame with a sketch stroke (distinct from the
 * note FileGlyph so boards read as canvases in the tree + tab strip). */
export function BoardGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 15c2-4 4-4 5-2s3 1 5-3" />
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

/** Titlebar "split right" — rounded rect, VERTICAL center divider = two
 *  columns. Standalone (not the shared Glyph) but matched to the line-glyph
 *  grammar: strokeWidth 1.7, round joins (Seth, 2026-06-15: one weight across
 *  the titlebar). */
export function SplitRightGlyph({ size = 16, className }: GlyphProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.6" />
      <path d="M12 4.2v15.6" />
    </svg>
  );
}

/** Titlebar "split down" — rounded rect, HORIZONTAL center divider = two
 *  rows. Same standalone shape as SplitRightGlyph (Seth, 2026-06-15). */
export function SplitDownGlyph({ size = 16, className }: GlyphProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.6" />
      <path d="M3.2 12h17.6" />
    </svg>
  );
}

/** Unified sidebar toggle (Seth, 2026-06-13) — rounded rect with a filled
 *  left column, reading as "side panels". Lives inline left of the note-list
 *  filter; the one control that hides/shows both rails with memory. */
export function SidebarGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M5.5 8.5h1M5.5 12h1" />
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

/* — destination row icons (Seth, 2026-06-13): the five reserved roots in the
   unified sidebar — Inbox (tray), Brain (head), Storage (database, reused),
   Archive (box), Trash (bin). currentColor only, no hex. — */

/** Inbox destination — a tray with the incoming notch. */
export function InboxGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 13h4l1.5 2.5h5L16 13h4" />
      <path d="M5.5 5.5 4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4l-1.5-7.5A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.9 1.5Z" />
    </Glyph>
  );
}

/** Brain destination — a profile head with the brain fold. */
export function BrainGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9.5 4.5a3 3 0 0 0-3 3 3 3 0 0 0-1.5 5.4V17a2.5 2.5 0 0 0 2.5 2.5h.5" />
      <path d="M14.5 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1.5 5.4V17a2.5 2.5 0 0 1-2.5 2.5H16" />
      <path d="M12 4.8v15M9.5 9.5h2.5M12 13.5h3" />
    </Glyph>
  );
}

/** Storage destination — reuses the database barrel (matches Settings). */
export function StorageGlyph(props: GlyphProps) {
  return <DatabaseGlyph {...props} />;
}

/** Archive destination — a lidded box with a pull slot. */
export function ArchiveGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </Glyph>
  );
}

/** Trash destination — a bin with lid + two staves. */
export function TrashGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M10 11v6M14 11v6" />
    </Glyph>
  );
}
