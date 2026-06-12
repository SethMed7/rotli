// The seam components actually consume: TanStack Query hooks over the typed
// service. No component touches notesService directly.

import { useMutation, useQuery } from "@tanstack/react-query";
import { notesService } from "./notes";
import { queryClient } from "./query";

export const keys = {
  folders: ["folders"] as const,
  notes: (folderId?: string) => ["notes", folderId ?? "all"] as const,
  note: (id: string) => ["note", id] as const,
};

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
    mutationFn: (name: string) => notesService.createFolder(name),
    onSuccess: () => invalidateFolders(),
  });
}
