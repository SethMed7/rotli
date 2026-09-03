// Core domain + layout types for the notes surface.
// Tabs are typed from day one (r2 chat-on-note locks): panes host *surfaces*,
// and the surfaceKind union grows ('chat', …) without touching the pane tree.

export interface Folder {
  id: string;
  name: string;
  /** Optional kit icon override; folders default to the folder glyph. */
  icon?: string;
  /** Folders nest (Work → Northstar), mirroring the future on-disk corpus. */
  parentId: string | null;
}

export interface NoteSummary {
  id: string; // ulid-style
  title: string;
  snippet: string;
  /** Exact editor-body emptiness from the owning adapter. Main/named views use
   * it to suppress durable blank placeholders without guessing from a title or
   * snippet. Optional only for older browser fixtures and compatibility data. */
  bodyEmpty?: boolean;
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
  /** Opaque complete-file revision returned by the enforcing adapter. */
  revision: string;
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
  /** 0 title substring · 1 every word in the title · 2 body substring ·
   * 3 every word in the body · 4 index-only (typo) hit with nothing to frame */
  rank: number;
  matchStart: number;
  matchLen: number;
  /** [start, len] char spans — into the title for ranks 0–1, into `snippet`
   * for 2–3, empty for 4. matchStart/matchLen mirror the first span. */
  spans: [number, number][];
  updatedAt: number;
}

/** Per-tab view state only — the document buffer is shared per noteId
 * (r2 lock #4); tabs hold cursor/scroll, never content. */
/** Discriminated union, ready to extend: `| { surfaceKind: "chat"; … }`. */
export interface NoteTab {
  id: string;
  /** A PREVIEW tab (single-click browse): the next plain open REUSES it.
   * Editing or re-clicking the same item keeps it (drops the flag). */
  preview?: boolean;
  surfaceKind: "note";
  noteId: string;
  /** Session-only handoff hint for a note that began as an optimistic Command-T
   * editor. The viewstate validator intentionally drops it at persistence. */
  focusOnMount?: boolean;
}

/** An Excalidraw canvas tab. boardId IS the board's corpus-relative path
 * (e.g. "Inbox/excalidraw/ideas.excalidraw") — boards live as real .excalidraw
 * files next to .md notes; the file is the source of truth. */
export interface CanvasTab {
  id: string;
  /** A PREVIEW tab (single-click browse): the next plain open REUSES it.
   * Editing or re-clicking the same item keeps it (drops the flag). */
  preview?: boolean;
  surfaceKind: "canvas";
  boardId: string;
}

/** A chat tab — chatSlug is the chats/<slug>.md basename, or null for a fresh
 * unsent chat (the file is created on the first send, then the tab is bound to it). */
export interface ChatTab {
  id: string;
  /** Never set for this kind — present so the union reads uniformly. */
  preview?: boolean;
  surfaceKind: "chat";
  chatSlug: string | null;
  /** Stable owner of the chat file. Optional only for legacy viewstate and a
   * pristine chat that has not resolved the active vault yet. */
  vaultId?: string;
}

/** A surfaced binary FILE tab (audio/pdf/image/text) — rendered IN-APP, never
 * shelled to the OS. fileId IS the file's corpus wire id (its relative path,
 * possibly root-prefixed like "vault:storage/x.mp3"). */
export interface FileTab {
  id: string;
  /** A PREVIEW tab (single-click browse): the next plain open REUSES it.
   * Editing or re-clicking the same item keeps it (drops the flag). */
  preview?: boolean;
  surfaceKind: "file";
  fileId: string;
}

/** The Brain Activity view — the AI-Filer change journal (see/review/undo). A
 * singleton view (no per-note binding). */
export interface ActivityTab {
  id: string;
  /** Never set for this kind — present so the union reads uniformly. */
  preview?: boolean;
  surfaceKind: "activity";
}

/** The ⌘N chooser — a blank new tab with NO type yet (the maintainer, 2026-07-29:
 * "you have to choose board / md / doc etc"); picking a kind replaces it
 * with the created item's real surface. */
export interface NewItemTab {
  id: string;
  /** Never set for this kind — present so the union reads uniformly. */
  preview?: boolean;
  surfaceKind: "newItem";
  /** Present only while ⌘T's durable creator runs. The tab itself is opened in
   * the key event, then retargeted in place once the file exists. */
  pendingLabel?: string;
  /** This pending item already owns a live Markdown buffer and renders the real
   * editor while its durable file is being created. */
  pendingNote?: boolean;
}

/** A private browser tab holds identity only. Its URL/history belong to the
 * non-persistent native webview and are intentionally absent from viewstate. */
export interface BrowserTab {
  id: string;
  preview?: boolean;
  surfaceKind: "browser";
}

export type Tab = NoteTab | CanvasTab | ChatTab | FileTab | ActivityTab | NewItemTab | BrowserTab;

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
