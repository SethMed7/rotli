// The Chat window's two marks, and New chat's (kept out of glyphs.tsx, which
// sits at its size ceiling). Same voice as the rest: 24-grid, 1.7 stroke,
// currentColor.

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

/** New chat — the chat bubble with the corner + that New note and New folder
 * wear in the section headers (the owner, 2026-09-21). */
export function NewChatGlyph({ size = 15 }: { size?: number }) {
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
      <path d="M13 5H7a2 2 0 0 0-2 2v12.5L9 16h4" />
      <path d="M18 14.5v6M15 17.5h6" />
      <path d="M17 5h2a2 2 0 0 1 2 2v3" />
    </svg>
  );
}
