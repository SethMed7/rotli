// The seam components actually consume: TanStack Query hooks over the typed
// service. No component touches notesService directly.

import { keepPreviousData, useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { replaceTitleLine } from "../lib/noteTitle";
import {
  type CorpusRoot,
  corpusFileStat,
  corpusListConfig,
  corpusMoveFileToSink,
  isTauri,
  organizerSecureHints,
  organizerStatus,
  secureRepairScan,
} from "../lib/tauri";
import { readJournal } from "./brainJournalStore";
import { DEST, isChats, isChatsPath, isSink } from "./destinations";
import { memexRootMarkers } from "./fsNotes";
import { trashVirtualFolderItems } from "./folderTrash";
import { notesService } from "./notes";
import { queryClient } from "./query";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";

/** Surface a lifecycle failure inline instead of swallowing it — the memex write
 * gate can refuse a move, and a silent rejection reads as "nothing happened"
 * (Seth, 2026-07-07). Rendered by the sidebar's row-action error banner. */
export const lifecycleError = (verb: string) => (e: unknown) =>
  useUiStore
    .getState()
    .setRowActionError(`Couldn’t ${verb} this note — ${e instanceof Error ? e.message : String(e)}`);

export const keys = {
  folders: ["folders"] as const,
  // null is the ALL-notes sentinel — a real folder named "all" must get its
  // own cache entry, not share (and clobber) the default view's (#77, audit
  // 2026-07). null can never collide with a folder id (ids are strings).
  notes: (folderId?: string) => ["notes", folderId ?? null] as const,
  note: (id: string) => ["note", id] as const,
  roots: ["corpus-roots"] as const,
  memexRoots: ["memex-root-markers"] as const,
  journal: ["journal"] as const,
  organizer: ["organizer-status"] as const,
  secureRepair: ["secure-repair"] as const,
  secureHints: ["secure-hints"] as const,
};

/** The connected brains, as sidebar roots (their `vault:`-style rows). Tauri-only.
 * The set only changes on a relaunch (connecting/forgetting a brain restarts), so
 * it's effectively static per session. Derived from the unified `corpus.json`. */
export function useCorpusRoots() {
  return useQuery({
    queryKey: keys.roots,
    queryFn: async (): Promise<CorpusRoot[]> => {
      if (!isTauri()) return [];
      const cfg = await corpusListConfig();
      return [...cfg.brains.map((b) => ({ id: b.id, label: b.label, absPath: b.absPath })), ...cfg.folders];
    },
    staleTime: Infinity,
  });
}

export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: () => notesService.listFolders() });
}

export function useNotes(folderId?: string) {
  return useQuery({
    queryKey: keys.notes(folderId),
    queryFn: () => notesService.listNotes(folderId),
  });
}

/** Every listing that can hold a note — the default view, the roots it hides
 * (Board = STAGED wiki/_inbox notes, Archive, Trash), the external Vault, AND
 * every ADDED root ("<rootid>:" — a note there is as real as a vault note: its
 * Main ref must survive GC, its tab needs a title). Same query keys as
 * useNotes(), so these are cache reads of the one corpus_list, not extra
 * fetches. Returns the lists (undefined until each loads) plus `complete` —
 * true only when the roots list AND every note listing have SUCCEEDED.
 * combine returns plain arrays (not a Map) so TanStack's structural sharing
 * keeps the identity stable across renders when nothing changed. */
function useNoteUniverse(): { lists: (NoteSummary[] | undefined)[]; complete: boolean } {
  const roots = useCorpusRoots();
  // the vault marker ("vault:") is already one of the reserved five — the Set
  // dedupes it so the vault brain doesn't ride twice
  const markers = new Set([
    DEST.vault,
    ...(roots.data ?? []).filter((r) => r.id !== "default").map((r) => `${r.id}:`),
  ]);
  const folderIds: (string | undefined)[] = [
    undefined,
    DEST.board,
    // Binary files stay out of ordinary note search below, but belong in the
    // identity universe so Main, tabs, and typed embed pickers can resolve them.
    DEST.storage,
    DEST.archive,
    DEST.trash,
    ...markers,
  ];
  const rootsReady = roots.isSuccess;
  return useQueries({
    queries: folderIds.map((folderId) => ({
      queryKey: keys.notes(folderId),
      queryFn: () => notesService.listNotes(folderId),
    })),
    combine: (results) => ({
      lists: results.map((r) => r.data),
      complete: rootsReady && results.every((r) => r.isSuccess),
    }),
  });
}

/** The ONE id → summary index over EVERY note that exists. useNotes() alone is
 * a VIEW, not the universe; anything that treats it as "all notes" silently
 * loses staged/vaulted/added-root notes (the bug that GC'd Seth's seeded Main
 * and labeled his tab "Untitled"). The Main projection, tab titles, and the
 * row-menu lookup read THIS instead. */
export function useNoteIndex(): Map<string, NoteSummary> {
  const { lists } = useNoteUniverse();
  return useMemo(() => {
    const index = new Map<string, NoteSummary>();
    for (const list of lists) for (const n of list ?? []) index.set(n.id, n);
    return index;
  }, [lists]);
}

/** liveIds for the Main-manifest GC — undefined until EVERY listing has
 * SUCCEEDED (setTree treats undefined as skip-GC). A vault on a disconnected
 * drive (its query errors forever) or the first render frames (lists still
 * loading) must never read as "these notes don't exist": passing a shrunken
 * set pruned live refs out of the COMMITTED .rotli/main.json for good — the
 * exact silent-GC failure this index fixed for staged notes, re-armed through
 * a narrower door. Better to skip a GC than to amputate the manifest. */
export function useMainGcIds(): Set<string> | undefined {
  const { lists, complete } = useNoteUniverse();
  return useMemo(() => {
    if (!complete) return undefined;
    const ids = new Set<string>();
    for (const list of lists) for (const n of list ?? []) ids.add(n.id);
    return ids;
  }, [lists, complete]);
}

/** Every SEARCHABLE note — the merged universe (staged Board + Brain wiki/ +
 * Vault + added roots + plain folders) minus what note search never lists:
 * binary files, memex chats/ transcripts (the Chat front owns them; a PLAIN
 * root's "chats" folder is just a folder and stays in), and the two sinks
 * (Archive stays reachable via its own row AND full-text search; Trash never
 * surfaces). The ⌘K palette, All notes, and the Quick ⌘P picker all read
 * THIS — useNotes() alone is a VIEW that silently misses staged notes (the
 * 2026-07-01 search audit's P0: a staged Main note was unfindable everywhere).
 * `ready` = every listing has SUCCEEDED (the same completeness bar as the GC). */
export function useSearchableNotes(): { notes: NoteSummary[]; ready: boolean } {
  const { lists, complete } = useNoteUniverse();
  // which roots' chats/ means transcripts — session-static, like the roots list.
  // Browser twin: the one seeded memex is the Vault brain (mirrors notes.ts).
  const memexQ = useQuery({
    queryKey: keys.memexRoots,
    queryFn: (): Promise<ReadonlySet<string>> | ReadonlySet<string> =>
      isTauri() ? memexRootMarkers() : new Set([DEST.vault]),
    staleTime: Infinity,
  });
  const memex = memexQ.data;
  const notes = useMemo(() => {
    const seen = new Map<string, NoteSummary>();
    for (const list of lists)
      for (const n of list ?? []) {
        // until the markers load, fall back to the pure shape test — the
        // conservative transient (a plain root's chats/ appears a beat later,
        // never flashes in and out)
        const chats = memex ? isChats(n.folderId, memex) : isChatsPath(n.folderId);
        if (n.kind === "file" || isSink(n.folderId) || chats) continue;
        seen.set(n.id, n);
      }
    return [...seen.values()];
  }, [lists, memex]);
  return { notes, ready: complete };
}

/** A value that settles `ms` after its source stops changing. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** FULL-TEXT body search (corpus_search / the browser twin), debounced 180ms,
 * min 2 chars. keepPreviousData keeps rows steady between keystrokes; the
 * short staleTime means an edit made seconds ago is re-findable (search sits
 * outside the ["notes"] invalidation beat). Consumers must gate on their OWN
 * live query length — a placeholder can briefly carry the previous query's
 * hits. */
export function useNoteSearch(query: string) {
  const q = useDebouncedValue(query.trim(), 180);
  return useQuery({
    queryKey: ["search", q],
    queryFn: () => notesService.searchNotes(q, 50),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

export function useNote(id: string) {
  return useQuery({ queryKey: keys.note(id), queryFn: () => notesService.getNote(id) });
}

export async function invalidateNotes(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["notes"] });
  await queryClient.invalidateQueries({ queryKey: ["note"] });
}

export async function invalidateFolders(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: keys.folders });
}

/** Notes AND folders together — a lifecycle change shifts both the lists and
 * the hidden-root counts (restore can even resurrect a folder). */
async function invalidateBoth(): Promise<void> {
  await invalidateNotes();
  await invalidateFolders();
}

/** The brain change journal, raw — consumers fold it with `deriveJournal` (the
 * one grammar). Refreshed by the daemon's `rotli:brain-journal` event (App.tsx)
 * and after every frontend journal write (approve/dismiss/undo/file). */
export function useJournal() {
  return useQuery({ queryKey: keys.journal, queryFn: readJournal });
}

/** Live daemon status (Activity's secure-skip + offline lines, Settings → Brain).
 * Rides the journal invalidation beat — and the daemon emits `rotli:brain-journal`
 * on STATUS-ONLY changes too (secrets skipped, model offline/back). The slow
 * poll is the backstop for anything eventless (the queue count while offline,
 * an error set outside a cycle) — the app-wide staleTime is ∞, so without it
 * this surface would never refresh on its own. */
export function useOrganizerStatus() {
  return useQuery({ queryKey: keys.organizer, queryFn: organizerStatus, refetchInterval: 60_000 });
}

/** Legacy secure-intake notes awaiting the explicit repair (decision
 * 2026-07-22) — the Activity pane's preview. Rides the journal invalidation
 * beat; the slow poll matches the organizer-status backstop. */
export function useSecureRepair() {
  return useQuery({ queryKey: keys.secureRepair, queryFn: secureRepairScan, refetchInterval: 60_000 });
}

/** The secure-review rows (feature B): detector-only notes awaiting the user's
 * Make secure / Not sensitive answer, plus flagged leftovers. Same beat. */
export function useSecureHints() {
  return useQuery({ queryKey: keys.secureHints, queryFn: organizerSecureHints, refetchInterval: 60_000 });
}

export async function invalidateJournal(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: keys.journal });
  await queryClient.invalidateQueries({ queryKey: keys.organizer });
  await queryClient.invalidateQueries({ queryKey: keys.secureRepair });
  await queryClient.invalidateQueries({ queryKey: keys.secureHints });
}

// ——— lifecycle (Phase 2c): a note's home changes (archive/trash/restore).

export function useArchiveNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.archiveNote(id),
    onSuccess: invalidateBoth,
    onError: lifecycleError("archive"),
  });
}

export function useTrashNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.trashNote(id),
    onSuccess: invalidateBoth,
    onError: lifecycleError("delete"),
  });
}

/** Trash every durable item referenced by one virtual Main/view folder. Files
 * are preflighted before the first write; notes/boards then use the same
 * lifecycle lanes as their individual menus. A partial runtime failure keeps
 * the virtual folder in place and reports exact progress instead of pretending
 * the batch was atomic. */
export function useTrashItems() {
  return useMutation({
    mutationFn: (items: NoteSummary[]) =>
      trashVirtualFolderItems(items, {
        fileStat: corpusFileStat,
        moveFile: corpusMoveFileToSink,
        trashNote: (id) => notesService.trashNote(id),
      }),
    onError: (error) =>
      useUiStore
        .getState()
        .setRowActionError(
          `Couldn’t move this folder to Trash — ${error instanceof Error ? error.message : String(error)}`,
        ),
    onSettled: invalidateBoth,
  });
}

/** Rename a note = rewrite its first H1. H1-less legacy notes adopt one at
 * their former first-non-empty title line. Composed from getNote + updateNote. */
export function useRenameNote() {
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const t = title.trim();
      if (!t) return;
      const note = await notesService.getNote(id);
      if (!note) throw new Error(`unknown note: ${id}`);
      await notesService.updateNote(id, replaceTitleLine(note.body ?? "", t));
    },
    onSuccess: async () => {
      await invalidateNotes();
    },
  });
}

export function useRestoreNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.restoreNote(id),
    onSuccess: invalidateBoth,
    onError: lifecycleError("restore"),
  });
}
