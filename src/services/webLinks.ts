// The Links projection where there is no Rust: Rotli Web and the browser twin.
// Same rules as corpus_links.rs — every live Markdown note (never Archive,
// Trash, or a chat transcript) with the raw wikilinks its body writes, fenced
// and inline code skipped, plus the Librarian's frontmatter `links:` targets
// the adapter read. Resolution happens later, in src/graph/model.ts.

import { looksSecret } from "../ai/guard";
import { bodyLinkTargets } from "../graph/linkTargets";
import type { NoteLinks } from "../graph/model";
import { inSecureFolder } from "../security/secureNotes";
import type { Note, NoteSummary } from "../types";
import { liveWebNotes } from "./webTasks";

/** One rule on the Mac and the web (audit 2026-10-06): a note is secure when
 * its flag, a secure folder, or the secret detector on its body says so. */
export function webLinkSecure(
  summary: Pick<NoteSummary, "secure">,
  note: Pick<Note, "folderId" | "diskFolderId" | "body">,
): boolean {
  return summary.secure === true || inSecureFolder(note) || looksSecret(note.body);
}

export async function listWebLinks(): Promise<NoteLinks[]> {
  return (await liveWebNotes()).map(({ summary, note }) => ({
    noteId: note.id,
    secure: webLinkSecure(summary, note),
    targets: bodyLinkTargets(note.body),
    suggested: note.suggestedLinks ?? [],
  }));
}
