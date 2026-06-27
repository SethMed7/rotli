// The seam components actually consume: TanStack Query hooks over the typed
// service. No component touches notesService directly.

import { useMutation, useQuery } from "@tanstack/react-query";
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

export function useCreateFolder() {
  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string | null }) =>
      notesService.createFolder(name, parentId),
    onSuccess: () => invalidateFolders(),
  });
}

// ——— lifecycle (Phase 2c): a note's home changes (move/archive/trash/restore).
// All four invalidate notes AND folders — restore can resurrect a folder, and
// archive/trash shift the hidden-root counts (Seth, 2026-06-13).

export function useMoveNote() {
  return useMutation({
    mutationFn: ({ id, targetFolder }: { id: string; targetFolder: string }) =>
      notesService.moveNote(id, targetFolder),
    onSuccess: async () => {
      await invalidateNotes();
      await invalidateFolders();
    },
  });
}

export function useArchiveNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.archiveNote(id),
    onSuccess: async () => {
      await invalidateNotes();
      await invalidateFolders();
    },
  });
}

export function useTrashNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.trashNote(id),
    onSuccess: async () => {
      await invalidateNotes();
      await invalidateFolders();
    },
  });
}

export function useRestoreNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.restoreNote(id),
    onSuccess: async () => {
      await invalidateNotes();
      await invalidateFolders();
    },
  });
}
