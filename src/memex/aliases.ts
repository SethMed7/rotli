// Which names a rename keeps as aliases (Round Three, 2026-09-26). Twins of
// corpus.rs `is_placeholder_alias` / `is_title_typing_trail`: the web notes
// services follow the same rule the Rust corpus applies on every save.

/** A fresh note's placeholder name: the title "Untitled" or its file stem
 * "untitled" / "untitled (2)". Nothing links to it, so it is never an alias
 * (Round Three, 2026-09-26). Twin of corpus.rs `is_placeholder_alias`. */
export const isPlaceholderAlias = (value: string): boolean =>
  /^untitled(?: \(\d+\))?$/.test(value.trim().toLowerCase());

/** Autosave sees a title while it is still being typed ("Round", "Round
 * Three -"). When one title extends the other the change is that typing
 * trail, not a rename. Twin of corpus.rs `is_title_typing_trail`. */
export function isTitleTypingTrail(oldTitle: string, newTitle: string): boolean {
  const [before, after] = [oldTitle.trim().toLowerCase(), newTitle.trim().toLowerCase()];
  return !!before && !!after && (after.startsWith(before) || before.startsWith(after));
}
