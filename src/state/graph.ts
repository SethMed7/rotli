// The Graph view's state. The scope is session-only (the graph is a
// projection, and reopening it starts from the whole vault unless a note
// asked for its neighborhood). Whether the Librarian's links show is
// remembered on this Mac (state/appExtras.ts) — on by default, so people see
// what the Librarian does (owner decision 2026-10-06).

import { create } from "zustand";

import { ALL_NOTES_SCOPE, type GraphScope } from "../graph/workflow";
import { useUiStore } from "./ui";

interface GraphState {
  scope: GraphScope;
  setScope: (scope: GraphScope) => void;
  librarianLinks: boolean;
  setLibrarianLinks: (on: boolean) => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  scope: ALL_NOTES_SCOPE,
  setScope: (scope) => set({ scope }),
  librarianLinks: true,
  setLibrarianLinks: (librarianLinks) => set({ librarianLinks }),
}));

/** Open the Graph view — the whole vault, or around one note. */
export function openGraph(scope: GraphScope = ALL_NOTES_SCOPE): void {
  useGraphStore.getState().setScope(scope);
  const ui = useUiStore.getState();
  ui.setSettingsOpen(false);
  ui.setSidebarMode("notes");
  ui.setContentView("graph");
}
