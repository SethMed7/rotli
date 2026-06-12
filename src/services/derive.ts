// Title/snippet derivation shared by both NotesService implementations.
// THE TITLE LAW: the title is DERIVED from the first line, never stored —
// the Rust corpus derives its own for list rows (corpus.rs title_of); these
// fill the gaps the wire doesn't carry (getNote) and the in-memory service.

export function titleOf(body: string): string {
  return body.split("\n", 1)[0]?.replace(/^#+\s*/, "").trim() || "Untitled";
}

/** First lines after the title, markdown punctuation stripped, for list rows. */
export function snippetOf(body: string): string {
  const lines = body.split("\n");
  const rest = lines.slice(1).join(" ");
  return rest
    .replace(/^#+\s*/g, "")
    .replace(/[*_`>#]|\[[x ]\]|^- /g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}
