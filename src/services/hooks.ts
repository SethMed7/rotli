// The seam components actually consume: TanStack Query hooks over the typed
// service. No component touches notesService directly.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { replaceTitleLine } from "../lib/noteTitle";
import { type CorpusRoot, corpusListConfig, isTauri } from "../lib/tauri";
import { notesService } from "./notes";
import { queryClient } from "./query";

export const keys = {
  folders: ["folders"] as const,
  notes: (folderId?: string) => ["notes", folderId ?? "all"] as const,
  note: (id: string) => ["note", id] as const,
  roots: ["corpus-roots"] as const,
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
