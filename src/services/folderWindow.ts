// A folder opened from Finder in its own window (docs/design/open-in-rotli.md,
// stage 2; src-tauri/src/folder_window.rs). The window runs the same bundle
// with `?window=folder&root=finder_<hash>`, and installs the notes service
// below: the main corpus lane, listing ONE folder instead of the vault. Every
// id it lists is prefixed with the folder's mount, so reads and saves route
// back to it alone. Nothing is created, moved, or filed from here, and Rust
// refuses it too.

import { useQuery } from "@tanstack/react-query";

import { onAddVault, onNativeCloseTab, onOpenNotice } from "../lib/hostEvents";
import {
  type CorpusListPayload,
  corpusListRoot,
  folderWindowAddAsVault,
  startWindowDrag,
  toggleMaximize,
} from "../lib/tauri";
import { RAW_ROOT_PREFIX } from "../state/paneVaults";
import type { Folder, Note, NoteSummary, SearchHit } from "../types";
import { FsNotesService } from "./fsNotes";

const STAYS_AS_IT_IS = "A folder opened from Finder stays exactly as it is. Add it as a vault first.";

/** A folder window's listing: its folders and items, ids prefixed by the mount. */
export type FolderListing = CorpusListPayload;

/** This window's folder mount, or null when this isn't a folder window. */
export function folderWindowRoot(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const root = params.get("root");
  return params.get("window") === "folder" && root?.startsWith(RAW_ROOT_PREFIX) ? root : null;
}

function refused<T>(): Promise<T> {
  return Promise.reject(new Error(STAYS_AS_IT_IS));
}

export class FolderWindowNotesService extends FsNotesService {
  readonly root: string;

  constructor(root: string) {
    super();
    this.root = root;
  }

  override async listFolders(): Promise<Folder[]> {
    return [...(await corpusListRoot(this.root)).folders];
  }

  override async listAll(): Promise<NoteSummary[]> {
    return [...(await corpusListRoot(this.root)).notes];
  }

  override async listNotes(folderId?: string): Promise<NoteSummary[]> {
    const notes = await this.listAll();
    return folderId ? notes.filter((note) => note.folderId === folderId) : notes;
  }

  override async searchNotes(): Promise<SearchHit[]> {
    return [];
  }

  override createFolder(): Promise<Folder> {
    return refused();
  }

  override createNote(): Promise<Note> {
    return refused();
  }

  override moveNote(): Promise<Note> {
    return refused();
  }

  override archiveNote(): Promise<Note> {
    return refused();
  }

  override trashNote(): Promise<Note> {
    return refused();
  }

  override deleteNote(): Promise<void> {
    return refused();
  }
}

/** The folder window's title strip: drag to move, double-click to zoom. */
export function dragFolderWindow(): void {
  void startWindowDrag();
}

export function zoomFolderWindow(): void {
  void toggleMaximize();
}

/** "Add as vault": main runs its connect flow; this window closes once saved. */
export function addFolderAsVault(): Promise<void> {
  return folderWindowAddAsVault();
}

/** The window's own folder name (Rust puts it in the URL beside the mount). */
export function folderWindowName(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("name") ?? "";
}

/** The folder's listing for the tree; re-read whenever the window comes
 * forward (a folder opened from Finder has no file watcher). */
export function useFolderWindowListing(root: string) {
  return useQuery({
    queryKey: ["folder-window", root],
    queryFn: () => corpusListRoot(root),
    refetchOnWindowFocus: true,
  });
}

/** Main window: a folder window's "Add as vault" handed its folder over. */
export function onFolderAddedAsVault(cb: (path: string) => void): () => void {
  return onAddVault(cb);
}

/** The shell's listeners; returns the teardown. File → Close Tab closes a
 * tab here too, and a notice from Rust (a save that failed on close) shows. */
export function attachFolderShell(on: {
  closeTab: () => void;
  notice: (message: string) => void;
}): () => void {
  const stops = [onNativeCloseTab(on.closeTab), onOpenNotice(on.notice)];
  return () => stops.forEach((stop) => stop());
}
