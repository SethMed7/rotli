// The Librarian's "leave what's in sight" signal (the owner, 2026-09-30: "if
// it's visible anywhere leave it; the moment it isn't visible on the left
// menu, move it, so it's subtle and doesn't confuse users"). Only the Vault
// view sends ids — in Main a note's place never follows its file — and an
// empty list lets the daemon file everything as before.

import { organizerSetVisible } from "../lib/tauri";

export function setLibrarianVisible(ids: readonly string[]): void {
  void organizerSetVisible([...ids]).catch(() => {
    // the daemon isn't running (no memex, the web): nothing to hold back
  });
}
