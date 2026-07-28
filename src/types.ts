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
  /** Human-readable link/query selectors: current filename stem, canonical
   * title slug, and rename history. Stable identity remains `id`. */
  aliases?: string[];
  /** User-facing shelf/folder projection. In a memex this can differ from the
   * physical wiki folder that contains the note. */
  folderId: string;
  /** Physical folder containing the file. Optional for browser/demo seeds;
   * callers fall back to `folderId` when absent. */
  diskFolderId?: string | undefined;
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

/** One FULL-TEXT search hit — the corpus_search wire shape (Rust SearchHit,
 * camelCase) and the browser twin's output. rank 0 = title hit (matchStart/
 * matchLen index the TITLE; snippet is the stored list snippet), rank 1 = body
 * hit (offsets index `snippet`). Offsets are CHAR counts (code points) — slice
 * with [...spread], never String.slice (UTF-16 splits surrogate pairs). */
export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  folderId: string;
  kind: "note" | "board" | "file";
  rank: number;
  matchStart: number;
  matchLen: number;
  updatedAt: number;
}

/** Per-tab view state only — the document buffer is shared per noteId
 * (r2 lock #4); tabs hold cursor/scroll, never content. */
/** Discriminated union, ready to extend: `| { surfaceKind: "chat"; … }`. */
export interface NoteTab {
  id: string;
  surfaceKind: "note";
  noteId: string;
}

/** An Excalidraw canvas tab. boardId IS the board's corpus-relative path
 * (e.g. "Inbox/excalidraw/ideas.excalidraw") — boards live as real .excalidraw
 * files next to .md notes; the file is the source of truth. */
export interface CanvasTab {
  id: string;
  surfaceKind: "canvas";
  boardId: string;
}

/** A chat tab — chatSlug is the chats/<slug>.md basename, or null for a fresh
 * unsent chat (the file is created on the first send, then the tab is bound to it). */
export interface ChatTab {
  id: string;
  surfaceKind: "chat";
  chatSlug: string | null;
}

/** A surfaced binary FILE tab (audio/pdf/image/text) — rendered IN-APP, never
 * shelled to the OS. fileId IS the file's corpus wire id (its relative path,
 * possibly root-prefixed like "vault:storage/x.mp3"). */
export interface FileTab {
  id: string;
  surfaceKind: "file";
  fileId: string;
}

/** The Brain Activity view — the AI-Filer change journal (see/review/undo). A
 * singleton view (no per-note binding). */
export interface ActivityTab {
  id: string;
  surfaceKind: "activity";
}

export type Tab = NoteTab | CanvasTab | ChatTab | FileTab | ActivityTab;

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
