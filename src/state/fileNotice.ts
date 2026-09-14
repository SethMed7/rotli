// The one transient line for external files that arrived without landing
// where the person can see them: a Finder drop or paste with no note or chat
// under it (saved to Assets), or a paste that could not be read. Transient,
// never persisted; each notice dismisses itself and an older timer never
// clears a newer notice.

import { create } from "zustand";

interface FileNotice {
  id: number;
  message: string;
}

interface FileNoticeState {
  notice: FileNotice | null;
}

export const useFileNoticeStore = create<FileNoticeState>(() => ({ notice: null }));

let nextId = 0;

/** Show `message`; returns the notice id a later dismissal must name. */
export function showFileNotice(message: string): number {
  nextId += 1;
  useFileNoticeStore.setState({ notice: { id: nextId, message } });
  return nextId;
}

/** Dismiss notice `id` — a no-op once a newer notice replaced it. */
export function dismissFileNotice(id: number): void {
  if (useFileNoticeStore.getState().notice?.id === id) useFileNoticeStore.setState({ notice: null });
}
