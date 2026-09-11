import { seedPrivateBrowserTab } from "../lib/privateBrowser";
import { ulid } from "../services/notes";
import type { Tab } from "../types";

export function makeTab(noteId: string): Tab {
  return { id: ulid(), surfaceKind: "note", noteId };
}

export function makeCanvasTab(boardId: string): Tab {
  return { id: ulid(), surfaceKind: "canvas", boardId };
}

export function makeChatTab(chatSlug: string | null, vaultId?: string): Tab {
  return { id: ulid(), surfaceKind: "chat", chatSlug, ...(vaultId ? { vaultId } : {}) };
}

export function makeFileTab(fileId: string): Tab {
  return { id: ulid(), surfaceKind: "file", fileId };
}

export function makeActivityTab(): Tab {
  return { id: ulid(), surfaceKind: "activity" };
}

export function makeNewItemTab(pendingLabel?: string, pendingNote = false): Tab {
  return {
    id: ulid(),
    surfaceKind: "newItem",
    ...(pendingLabel ? { pendingLabel } : {}),
    ...(pendingNote ? { pendingNote: true } : {}),
  };
}

export function makeBrowserTab(url?: string): Tab {
  const tab: Tab = { id: ulid(), surfaceKind: "browser" };
  seedPrivateBrowserTab(tab.id, url);
  return tab;
}
