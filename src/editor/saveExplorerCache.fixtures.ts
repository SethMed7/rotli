// The save-state explorer's note cache (tenth review of pull request 267, P1):
// a query's answer lands in the note's cache entry, and the editor takes what
// that entry holds in an effect of its own (editorSurface.tsx), so a save's
// publish into the cache and the editor taking it are two moves, as in the app.
import { keys } from "../services/hooks";
import { queryClient } from "../services/query";
import type { Note } from "../types";
import { adoptReadNote, stampRead } from "./model";
import type { Tracked, World } from "./saveExplorer.fixtures";

/** A query reads the file now; its answer reaches the cache later, and the
 * editor takes it from there later still. Refetching cancels the same query's
 * fetch still on its way (React Query's cancelRefetch), so two answers never
 * race into one entry. */
export function refetchInto(world: World, note: Tracked): void {
  note.unseen = false;
  for (const ack of world.acks)
    if (ack.kind === "answer" && ack.noteId === note.id && ack.state === "held") {
      ack.state = "settled";
      ack.reject(new Error("cancelled"));
    }
  const snapshot = stampRead(world.lane.read(note.id)!);
  void world
    .hold("answer", note.id, `“${snapshot.body.split("\n")[2] ?? ""}”`, () =>
      queryClient.setQueryData(keys.note(note.id), snapshot),
    )
    .catch(() => {});
}

/** Anything published into a note's cache entry (a query's answer, or a
 * save's `applyNoteWrite`) gives the editor one effect to take whatever the
 * entry holds when it runs (for a closed note, when it is shown again). */
export function watchCache(world: World): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (event.type !== "updated" || event.action.type !== "success" || key[0] !== "note") return;
    const noteId = String(key[1]);
    if (!world.notes.some((each) => each.id === noteId)) return;
    if (world.acks.some((ack) => ack.kind === "effect" && ack.noteId === noteId && ack.state === "held"))
      return;
    void world
      .hold("effect", noteId, "editor takes the cache", () => {
        const cached = queryClient.getQueryData<Note>(keys.note(noteId));
        if (cached) adoptReadNote(cached);
      })
      .catch(() => {});
  });
}
