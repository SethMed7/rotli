import { seedPrivateBrowserTab } from "../lib/privateBrowser";
import type { NewChatOrigin } from "../services/chatProjects";
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

export function makeProjectTab(projectId: string, vaultId?: string): Tab {
  return { id: ulid(), surfaceKind: "project", projectId, ...(vaultId ? { vaultId } : {}) };
}

/** Matches the tab showing this project's page. */
export function isProjectTab(projectId: string): (tab: Tab) => boolean {
  return (tab) => tab.surfaceKind === "project" && tab.projectId === projectId;
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

/** The origin a new chat records: an explicit project, else the focused tab —
 * a saved chat (its project, looked up at save) or a project page. */
export function newChatOriginFrom(focused: Tab | null, projectId?: string): NewChatOrigin | null {
  if (projectId) return { projectId };
  if (focused?.surfaceKind === "chat" && focused.chatSlug) return { chatSlug: focused.chatSlug };
  if (focused?.surfaceKind === "project") return { projectId: focused.projectId };
  return null;
}
