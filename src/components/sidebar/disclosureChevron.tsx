// The sidebar's one disclosure chevron: it rotates open with its row (the
// .fchev rule in styles/notes.css). Decoration only — the row owns the state.

import { ChevronRight } from "../glyphs";

export function DisclosureChevron({ open, size = 10 }: { open: boolean; size?: number }) {
  return (
    <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
      <ChevronRight size={size} />
    </span>
  );
}
