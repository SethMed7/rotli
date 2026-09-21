// The two marks of the Chat window (kept out of glyphs.tsx, which sits at its
// size ceiling). Same voice as the rest: 24-grid, 1.7 stroke, currentColor.

import type { ReactNode } from "react";

function Frame({ size = 15, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
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
      <path d="M13 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V11" />
      {children}
    </svg>
  );
}

/** Pull Chat out into its own window — the arrow leaves through the corner
 * (the "open in a new window" idiom). */
export function PopOutGlyph({ size }: { size?: number }) {
  return (
    <Frame {...(size ? { size } : {})}>
      <path d="M15 4h5v5M20 4l-8.5 8.5" />
    </Frame>
  );
}

/** Put Chat back in the main window — the same frame, the arrow coming home. */
export function RegroupGlyph({ size }: { size?: number }) {
  return (
    <Frame {...(size ? { size } : {})}>
      <path d="M16.5 12.5h-5v-5M11.5 12.5 20 4" />
    </Frame>
  );
}
