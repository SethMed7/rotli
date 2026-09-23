// The one seam every board surface reads, writes, creates, and renames boards
// through. Inside the Mac app the Rust corpus owns the `.excalidraw` files;
// Rotli Web writes the same files into its connected vault folder
// (folderBoards.ts over the VaultDir). A plain browser with no vault (the
// design-review twin) has no board storage at all, and says so.

import {
  corpusCreateBoard,
  corpusReadBoard,
  corpusRenameBoard,
  corpusRevealFile,
  corpusWriteBoard,
  isTauri,
} from "../lib/tauri";
import { FolderBoardStore } from "./folderBoards";
import { activeWebVaultDir } from "./webNotes";

export interface BoardStore {
  /** Create a board at its final name (collision-safe); omit `body` for an
   * empty scene. The id IS the new board's vault-relative path. */
  create(folderId: string, name: string, body?: string): Promise<{ id: string }>;
  read(id: string): Promise<{ body: string; revision: string }>;
  /** Refused when the file no longer matches `expectedRevision`. */
  write(id: string, body: string, expectedRevision: string): Promise<{ revision: string }>;
  rename(id: string, name: string): Promise<{ id: string }>;
  /** Show the file in the OS file manager; null where no shell can. */
  reveal: ((id: string) => Promise<void>) | null;
}

const desktopBoards: BoardStore = {
  create: async (folderId, name, body) => ({ id: (await corpusCreateBoard(folderId, name, body)).id }),
  read: async (id) => {
    const doc = await corpusReadBoard(id);
    return { body: doc.body, revision: doc.revision };
  },
  write: async (id, body, expectedRevision) => ({
    revision: (await corpusWriteBoard(id, body, expectedRevision)).revision,
  }),
  rename: async (id, name) => ({ id: (await corpusRenameBoard(id, name)).id }),
  reveal: (id) => corpusRevealFile(id),
};

function webBoards(store: FolderBoardStore): BoardStore {
  return {
    create: (folderId, name, body) => store.create(folderId, name, body),
    read: (id) => store.read(id),
    write: (id, body, expectedRevision) => store.write(id, body, expectedRevision),
    rename: (id, name) => store.rename(id, name),
    reveal: null,
  };
}

/** Where boards live in this session: the Mac corpus, the connected web
 * vault, or nowhere (null) — decided at call time, since the web vault
 * connects after startup. */
function currentBoardStore(): BoardStore | null {
  if (isTauri()) return desktopBoards;
  const dir = activeWebVaultDir();
  return dir ? webBoards(new FolderBoardStore(dir)) : null;
}

/** True when this session can open and save boards. */
export function boardsAvailable(): boolean {
  return currentBoardStore() !== null;
}

/** The board store, or a plain refusal when there is nowhere to keep boards. */
export function boardStore(): BoardStore {
  const store = currentBoardStore();
  if (!store) throw new Error("Boards need a vault folder — connect one to draw.");
  return store;
}
