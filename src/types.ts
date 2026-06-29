// Core domain + layout types for the notes surface.
// Tabs are typed from day one (r2 chat-on-note locks): panes host *surfaces*,
// and the surfaceKind union grows ('chat', …) without touching the pane tree.

export interface Folder {
  id: string;
  name: string;
  /** Optional kit icon override; folders default to the folder glyph. */
  icon?: string;
  /** Folders nest (Work → Myela), mirroring the future on-disk corpus. */
  parentId: string | null;
}

export interface NoteSummary {
  id: string; // ulid-style
  title: string;
  snippet: string;
  folderId: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  /** "note" (a .md file) · "board" (a .excalidraw canvas, id === its corpus path) ·
   * "file" (any other file — image/pdf/…, surfaced read-only, opened in the OS
   * default app). Optional/defaulted for back-compat with the in-memory seed. */
  kind?: "note" | "board" | "file";
}

export interface Note extends NoteSummary {
  body: string; // markdown
}

/** Per-tab view state only — the document buffer is shared per noteId
 * (r2 lock #4); tabs hold cursor/scroll, never content. */
export interface TabViewState {
  cursor: number;
  scroll: number;
}

/** Discriminated union, ready to extend: `| { surfaceKind: "chat"; … }`. */
export interface NoteTab {
  id: string;
  surfaceKind: "note";
  noteId: string;
  viewState: TabViewState;
}

/** An Excalidraw canvas tab. boardId IS the board's corpus-relative path
 * (e.g. "Inbox/excalidraw/ideas.excalidraw") — boards live as real .excalidraw
 * files next to .md notes; the file is the source of truth. */
export interface CanvasTab {
  id: string;
  surfaceKind: "canvas";
  boardId: string;
  viewState: TabViewState;
}

/** A chat tab — chatSlug is the chats/<slug>.md basename, or null for a fresh
 * unsent chat (the file is created on the first send, then the tab is bound to it). */
export interface ChatTab {
  id: string;
  surfaceKind: "chat";
  chatSlug: string | null;
  viewState: TabViewState;
}

export type Tab = NoteTab | CanvasTab | ChatTab;

export type SplitDir = "row" | "col";

export interface SplitNode {
  kind: "split";
  id: string;
  dir: SplitDir;
  children: PaneNode[];
  /** Fractions summing to 1, parallel to children. */
  sizes: number[];
}

export interface LeafNode {
  kind: "leaf";
  id: string;
  tabs: Tab[];
  activeTabId: string;
}

export type PaneNode = SplitNode | LeafNode;
