// The creation router (memex integration, Phase 2 — "the memex is the home").
// When a writable memex is connected, a new note defaults INTO it (wiki/_inbox
// staging, v3.5 contract) instead of the local corpus — unless the user explicitly
// picked a LOCAL folder, which is always respected. One place so every new-note
// entry point (⌘N, the + menu, …) routes identically.

import { CORPUS_INSTANCE_ID, activeInstance, isWritable } from "../memex/config";
import { loadConfig, writeNote } from "../memex/service";
import { VAULT_MARKER, isVault } from "./destinations";
import { notesService } from "./notes";

export type Route =
  | { kind: "memex"; shelf?: string[] }
  | { kind: "local"; folder: string };

/** The PURE routing decision (no I/O, so it unit-tests): given the selection, whether
 *  a smart row is selected, and whether a writable memex is active, decide whether a
 *  new note goes INTO the memex (and with which shelf) or a LOCAL folder.
 *  - An explicit LOCAL folder selection is ALWAYS respected (never diverted).
 *  - A smart row / a vault selection with a writable memex ⇒ the memex.
 *  - A selected SHELF folder (vault:<shelf>) seeds the note's shelf; the memex's
 *    structural folders (wiki/chats) and the bare marker fall back to the default. */
export function routeDecision(
  selectedFolderId: string,
  isSmart: boolean,
  memexWritable: boolean,
  localFallback: string,
): Route {
  const sel = selectedFolderId;
  const explicitLocal = !isSmart && sel !== "" && !isVault(sel);
  if (!explicitLocal && memexWritable) {
    const sub = isVault(sel) ? sel.slice(VAULT_MARKER.length) : "";
    const shelf =
      sub && !sub.startsWith("wiki") && sub !== "chats" && !sub.startsWith("chats/")
        ? [sub]
        : undefined;
    return shelf ? { kind: "memex", shelf } : { kind: "memex" };
  }
  const folder = isSmart || isVault(sel) || sel === "" ? localFallback : sel;
  return { kind: "local", folder };
}

export interface RoutedCreate {
  /** The currently selected folder id (a smart row, a local folder, or a vault one). */
  selectedFolderId: string;
  /** True when a smart row (All notes / Recent) is selected — no concrete folder. */
  isSmart: boolean;
  /** Where a LOCAL note lands when the selection is a smart row / the vault root. */
  localFallback: string;
  /** Initial body (usually ""). */
  body?: string;
}

/** Create a new note per `routeDecision`, returning its WIRE id (for opening). */
export async function createRoutedNote(opts: RoutedCreate): Promise<string> {
  const { selectedFolderId, isSmart, localFallback, body = "" } = opts;
  const active = activeInstance(await loadConfig());
  const route = routeDecision(selectedFolderId, isSmart, !!(active && isWritable(active)), localFallback);

  if (route.kind === "memex" && active) {
    const { id } = await writeNote({ instance: active, body, ...(route.shelf ? { shelf: route.shelf } : {}) });
    // open the new note via the active root's wire prefix: BARE for a memex CORPUS
    // (the default root), `<id>:` for a connected brain (e.g. `vault:`).
    const prefix = active.id === CORPUS_INSTANCE_ID ? "" : `${active.id}:`;
    return `${prefix}${id}`;
  }
  const note = await notesService.createNote(route.kind === "local" ? route.folder : localFallback, body);
  return note.id;
}
