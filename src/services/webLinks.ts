// The Links projection where there is no Rust: Rotli Web and the browser twin.
// Same rules as corpus_links.rs — every live Markdown note (never Archive,
// Trash, or a chat transcript) with the raw wikilinks its body writes, fenced
// and inline code skipped, plus the Librarian's frontmatter `links:` targets
// the adapter read. Resolution happens later, in src/graph/model.ts.

import { bodyLinkTargets } from "../graph/linkTargets";
import type { NoteLinks } from "../graph/model";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import { liveWebNotes } from "./webTasks";

export async function listWebLinks(): Promise<NoteLinks[]> {
  return (await liveWebNotes()).map(({ summary, note }) => ({
    noteId: note.id,
    secure:
      summary.secure === true || isSecureNotesFolder(note.folderId) || isSecureBrainFolder(note.folderId),
    targets: bodyLinkTargets(note.body),
    suggested: note.suggestedLinks ?? [],
  }));
}
