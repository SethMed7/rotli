// Where a note "lives", as a short human label for the editor's location chip
// (Seth, 2026-07-03: "I can't find where this file is"). Pure — derived from the
// note's folderId + whether it's referenced in Main. Main is a shortcut, so a
// note in Main ALSO has a Brain/disk home; the label shows both ("★ Main · …").

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The note's disk/Brain home, humanized (no Main prefix). */
export function brainLocationLabel(folderId: string): string {
  const f = folderId || "";
  if (f === "wiki") return "Brain";
  if (f.startsWith("wiki/_")) return "Captures"; // _inbox note-staging etc.
  if (f.startsWith("wiki/")) return titleCase(f.slice("wiki/".length).replace(/\//g, " › "));
  if (f === "Board") return "Captures";
  if (f === "Archive" || f === "Trash") return f;
  if (f.startsWith("Storage")) return f.replace(/\//g, " › ");
  if (f.startsWith("vault:")) {
    const sub = f.slice("vault:".length).replace(/^wiki\//, "");
    return sub ? `Library › ${titleCase(sub.replace(/\//g, " › "))}` : "Linked library";
  }
  if (f === "" || f === "Inbox") return "Inbox";
  return f;
}

/** The full location for the editor chip. `inMain` prefixes "★ Main · ". */
export function noteLocationLabel(folderId: string, inMain: boolean): string {
  const base = brainLocationLabel(folderId);
  return inMain ? `★ Main · ${base}` : base;
}
