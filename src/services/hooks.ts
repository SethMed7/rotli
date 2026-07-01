// The seam components actually consume: TanStack Query hooks over the typed
// service. No component touches notesService directly.

import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { replaceTitleLine } from "../lib/noteTitle";
import { type CorpusRoot, corpusListConfig, isTauri, organizerStatus } from "../lib/tauri";
import { readJournal } from "./brainJournal";
import { DEST } from "./destinations";
import { notesService } from "./notes";
import { queryClient } from "./query";
import type { NoteSummary } from "../types";

export const keys = {
  folders: ["folders"] as const,
  notes: (folderId?: string) => ["notes", folderId ?? "all"] as const,
  note: (id: string) => ["note", id] as const,
  roots: ["corpus-roots"] as const,
  journal: ["journal"] as const,
  organizer: ["organizer-status"] as const,
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
      return [
        ...cfg.brains.map((b) => ({ id: b.id, label: b.label, absPath: b.absPath })),
        ...cfg.folders,
      ];
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

export async function invalidateJournal(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: keys.journal });
  await queryClient.invalidateQueries({ queryKey: keys.organizer });
}

/** The Brain's area vocabulary (People/Projects/…): the wiki areas minus the
 * internal underscore folders — the ONE derivation every filing surface
 * (metadata panel, right-click drill, the Phase-4 daemon UI) shares. */
export function useBrainAreas(): string[] {
  const folders = useFolders().data ?? [];
  return useMemo(
    () =>
      folders.filter((f) => f.parentId === "wiki" && !f.name.startsWith("_")).map((f) => f.name),
    [folders],
  );
}

// ——— lifecycle (Phase 2c): a note's home changes (archive/trash/restore).

export function useArchiveNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.archiveNote(id),
    onSuccess: invalidateBoth,
  });
}

export function useTrashNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.trashNote(id),
    onSuccess: invalidateBoth,
  });
}

/** Rename a note = rewrite the FIRST non-empty line of its body (the note's
 * title is its first line). Preserves a leading heading marker if present, so a
 * `# Heading` stays a heading and a plain first line stays plain. Composed from
 * getNote + updateNote — no new service surface. */
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
  });
}
