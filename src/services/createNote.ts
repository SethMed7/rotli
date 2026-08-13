// The creation router (memex integration, Phase 2 — "the memex is the home").
// When a writable memex is connected, a new note defaults INTO it (wiki/_inbox
// staging, v3.5 contract) instead of the local corpus — unless the user explicitly
// picked a LOCAL folder, which is always respected. One place so every new-note
// entry point (⌘N, the + menu, …) routes identically.

import { CORPUS_INSTANCE_ID, activeInstance, isWritable } from "../memex/config";
import { loadConfig, writeNote } from "../memex/service";
import { creationIsSecure, isSecureNotesFolder } from "../security/secureNotes";
import { VAULT_MARKER, isHidden, isStorageLane, isVault, isWikiPath } from "./destinations";
import { notesService } from "./notes";

export type Route = { kind: "memex"; shelf?: string[] } | { kind: "local"; folder: string };

/** The Brain header is a virtual view over the default memex's `wiki/` tree,
 * not a physical folder named "Brain". Its id intentionally stays human-readable
 * in sidebar state, so creation routing must recognize it explicitly. */
const BRAIN_VIEW_ID = "Brain";

/** The PURE routing decision (no I/O, so it unit-tests): given the selection, whether
 *  a smart row is selected, and whether a writable memex is active, decide whether a
 *  new note goes INTO the memex (and with which shelf) or a LOCAL folder.
 *  - An explicit LOCAL folder selection is ALWAYS respected (never diverted) —
 *    except the hidden roots (Archive/Trash/Board): a note must never be BORN into
 *    a sink or the capture board (#5, audit 2026-07), so those route like a smart
 *    row (the memex staging when writable, else the local fallback).
 *  - A smart row / Main / Brain selection with a writable memex ⇒ Brain intake.
 *    The Brain header and its `wiki/**` areas are views over curated AI-owned
 *    locations, never direct interactive write targets.
 *  - A selected SHELF folder (vault:<shelf>) seeds the note's shelf; the memex's
 *    structural folders (wiki/chats) and the bare marker fall back to the default. */
export function routeDecision(
  selectedFolderId: string,
  isSmart: boolean,
  memexWritable: boolean,
  localFallback: string,
): Route {
  const sel = selectedFolderId;
  if (isSecureNotesFolder(sel) && memexWritable) {
    return { kind: "memex", shelf: [sel] };
  }
  const brainView = sel === BRAIN_VIEW_ID || isWikiPath(sel);
  const explicitLocal =
    !isSmart &&
    sel !== "" &&
    !isVault(sel) &&
    !isHidden(sel) &&
    !isStorageLane(sel) &&
    !(memexWritable && brainView);
  if (!explicitLocal && memexWritable) {
    const sub = isVault(sel) ? sel.slice(VAULT_MARKER.length) : "";
    const shelf =
      sub && !sub.startsWith("wiki") && sub !== "chats" && !sub.startsWith("chats/") ? [sub] : undefined;
    return shelf ? { kind: "memex", shelf } : { kind: "memex" };
  }
  const folder =
    isSmart || isVault(sel) || isHidden(sel) || isStorageLane(sel) || sel === "" ? localFallback : sel;
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
  /** Quick/private entry points can force secure while keeping their normal home. */
  secure?: boolean;
  /** Pin model/tool-created work to the chat's registered root instead of
   * consulting ambient UI selection again after an asynchronous run. */
  rootId?: string;
}

/** Resolve an explicit root capability without falling back to ambient UI
 * state. Kept pure so cross-root isolation remains regression-testable. */
export function instanceForRoot(config: Awaited<ReturnType<typeof loadConfig>>, rootId: string) {
  const id = rootId === "default" ? CORPUS_INSTANCE_ID : rootId;
  return config.instances.find((instance) => instance.id === id) ?? null;
}

/** Create a new note per `routeDecision`, returning its WIRE id (for opening). */
export async function createRoutedNote(opts: RoutedCreate): Promise<string> {
  const { selectedFolderId, isSmart, localFallback, body = "" } = opts;
  const config = await loadConfig();
  const active = opts.rootId ? instanceForRoot(config, opts.rootId) : activeInstance(config);
  if (opts.rootId && !active) {
    throw new Error(`The target vault “${opts.rootId}” is no longer registered.`);
  }
  if (opts.rootId && !isWritable(active)) {
    throw new Error(`The target vault “${opts.rootId}” is not writable.`);
  }
  const secure = creationIsSecure(
    selectedFolderId,
    opts.secure === undefined ? undefined : { secure: opts.secure },
  );
  const route = routeDecision(selectedFolderId, isSmart, !!(active && isWritable(active)), localFallback);

  if (route.kind === "memex" && active) {
    const { id } = await writeNote({
      instance: active,
      body,
      secure,
      ...(route.shelf ? { shelf: route.shelf } : {}),
    });
    // open the new note via the active root's wire prefix: BARE for a memex CORPUS
    // (the default root), `<id>:` for a connected brain (e.g. `vault:`).
    const prefix = active.id === CORPUS_INSTANCE_ID ? "" : `${active.id}:`;
    return `${prefix}${id}`;
  }
  const note = await notesService.createNote(route.kind === "local" ? route.folder : localFallback, body, {
    secure,
  });
  return note.id;
}
