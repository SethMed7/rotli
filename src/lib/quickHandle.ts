// The mounted Quick Note window registers itself here; the registry's quick.*
// actions that need the live component (new note, open search) route through
// this handle — the same seam pattern as captureHandle / the editor's
// activeEditor. The set-cycling and dismiss actions act on stores directly and
// need no handle.

export interface QuickHandle {
  /** Create a fresh note in the quick folder, add it to the set, open it. */
  newNote(): void;
  /** Open the search-and-swap overlay (pick any note into the set). */
  openSearch(): void;
}

let current: QuickHandle | null = null;

export function setQuickHandle(handle: QuickHandle | null): void {
  current = handle;
}

export function quickHandle(): QuickHandle | null {
  return current;
}
