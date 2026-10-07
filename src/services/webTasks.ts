// The Tasks projection where there is no Rust: Rotli Web and the browser twin.
// Same rules as corpus.rs `tasks()` / `toggle_task` through lib/taskLines —
// open checkboxes from every live note (never Archive, Trash, or a chat
// transcript), and a check-off that is a real note edit, refused if the line
// changed since the list was made.

import { checkOff, joinedTaskText, openTasksInBody } from "../lib/taskLines";
import type { TaskItem } from "../lib/tauri";
import type { Note, NoteSummary } from "../types";
import { isChatsPath, isSink } from "./destinations";
import { notesService } from "./notes";

const STALE = "This task changed since the list was made — it refreshes on its own.";

/** Every live Markdown note with its body — never Archive, Trash, or a chat
 * transcript. The walk the web twins of the Tasks and Links projections share. */
export async function liveWebNotes(): Promise<{ summary: NoteSummary; note: Note }[]> {
  const summaries = await notesService.listAll();
  const live = summaries.filter(
    (note) => (note.kind ?? "note") === "note" && !isSink(note.folderId) && !isChatsPath(note.folderId),
  );
  const notes = await Promise.all(live.map((summary) => notesService.getNote(summary.id)));
  return live.flatMap((summary, at) => {
    const note = notes[at];
    return note ? [{ summary, note }] : [];
  });
}

export async function listWebTasks(): Promise<TaskItem[]> {
  return (await liveWebNotes()).flatMap(({ note }) =>
    openTasksInBody(note.body).map((task) => ({
      noteId: note.id,
      noteTitle: note.title,
      line: task.line,
      text: task.text,
    })),
  );
}

export async function toggleWebTask(noteId: string, line: number, expect: string): Promise<void> {
  const note = await notesService.getNote(noteId);
  if (note === null) throw new Error(STALE);
  const lines = note.body.split("\n");
  const current = lines[line];
  // validate against the JOINED text — the same shape the list reported
  if (current === undefined || joinedTaskText(lines, line) !== expect) throw new Error(STALE);
  const checked = checkOff(current);
  if (checked === null) throw new Error(STALE);
  lines[line] = checked;
  await notesService.updateNote(note.id, lines.join("\n"), note.revision, note.body);
}
