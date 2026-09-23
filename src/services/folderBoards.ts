// Boards in a real vault folder — the TypeScript twin of the Rust board
// commands (corpus.rs `create_named_board`, `read_board`,
// `write_board_if_revision`, `rename_board`), for Rotli Web's connected
// vault. A board is a raw `.excalidraw` scene file: no frontmatter, its id IS
// its vault-relative path, and it never joins the note index. Rotli Web hands
// this a connected VaultDir; tests hand it MemoryVaultDir.

import { EMPTY_SCENE } from "../boards/session";
import { parseAndValidateBoard } from "../boards/validation";
import { DEST } from "./destinations";
import {
  type VaultDir,
  type VaultStat,
  baseName,
  freeVaultPath,
  joinVaultPath,
  normalizeVaultPath,
  parentPath,
  vaultIsMemex,
} from "./vaultDir";

const BOARD_EXT = ".excalidraw";
/** A memex vault's board lane (Rust `BOARD_LANE`): where a board is born when
 * the folder the user was in is not a writable note surface. */
export const BOARD_LANE = "storage/excalidraw";
/** An empty scene, byte-identical to Rust `EMPTY_EXCALIDRAW`
 * (parity.json `emptyBoardScene`). */
export const EMPTY_BOARD_FILE = JSON.stringify(EMPTY_SCENE);

const RESERVED = new Set<string>(Object.values(DEST));

export function isBoardPath(path: string): boolean {
  return path.endsWith(BOARD_EXT);
}

/** A board's display title: its file name without `.excalidraw` (Rust `board_title`). */
export function boardTitle(path: string): string {
  const name = baseName(path);
  return name.length > BOARD_EXT.length && isBoardPath(name) ? name.slice(0, -BOARD_EXT.length) : name;
}

/** The file stem a typed name becomes (Rust `board_name_stem`): trimmed, any
 * `.excalidraw` the person typed dropped, path separators flattened to `-`. */
export function boardNameStem(name: string): string {
  let stem = name.trim();
  while (stem.endsWith(BOARD_EXT)) stem = stem.slice(0, -BOARD_EXT.length);
  stem = stem.trim().replace(/[/\\]/g, "-").trim();
  if (!stem) throw new Error("a board needs a name");
  return stem;
}

/** The directory a new board is written into (Rust `create_board_with_stem`).
 * A memex keeps a board in the folder the person was in only when that folder
 * is a writable note surface (`wiki/`, `chats/`, the board lane); anything
 * else — Inbox, Storage, a projection, another root's id — lands in the board
 * lane, so every board has one home. A plain vault's reserved rows are its root. */
export function boardHome(folderId: string, isMemex: boolean): string {
  const local = normalizeVaultPath(folderId.slice(folderId.indexOf(":") + 1));
  const under = (root: string) => local === root || local.startsWith(`${root}/`);
  if (isMemex) return under("wiki") || under("chats") || under(BOARD_LANE) ? local : BOARD_LANE;
  return RESERVED.has(folderId) ? "" : local;
}

/** Boards collide as "name-2.excalidraw" (Rust `free_name`), not "name (2)". */
const boardCollision = (stem: string, ext: string, n: number) => `${stem}-${n}${ext}`;

const revisionOf = (stat: VaultStat) => `${stat.lastModified}:${stat.size}`;

function assertBoardId(id: string): void {
  if (!isBoardPath(id)) throw new Error(`not a board: ${id}`);
  if (normalizeVaultPath(id) !== id || id.split("/").includes(".."))
    throw new Error(`invalid board path: ${id}`);
}

export class FolderBoardStore {
  constructor(private readonly dir: VaultDir) {}

  /** Write a new board at its final name in one write; never replaces a file. */
  async create(folderId: string, name: string, body: string = EMPTY_BOARD_FILE): Promise<{ id: string }> {
    const stem = boardNameStem(name);
    parseAndValidateBoard(body);
    const home = boardHome(folderId, await vaultIsMemex(this.dir));
    const id = await freeVaultPath(this.dir, home, `${stem}${BOARD_EXT}`, boardCollision);
    await this.dir.writeText(id, body);
    return { id };
  }

  /** The raw scene and the revision a save must present. The stat is taken
   * BEFORE the read, so a write landing in between can only make the next
   * save conflict — never let it overwrite a version it didn't see. */
  async read(id: string): Promise<{ body: string; revision: string }> {
    assertBoardId(id);
    const stat = await this.dir.stat(id);
    if (!stat) throw new Error(`board not found: ${id}`);
    return { body: await this.dir.readText(id), revision: revisionOf(stat) };
  }

  /** Save only over the version the editor loaded, as notes do. */
  async write(id: string, body: string, expectedRevision: string): Promise<{ revision: string }> {
    assertBoardId(id);
    parseAndValidateBoard(body);
    const stat = await this.dir.stat(id);
    if (!stat) throw new Error(`board not found: ${id}`);
    const current = revisionOf(stat);
    if (!expectedRevision || expectedRevision !== current) {
      throw new Error(
        `revision conflict: expected ${expectedRevision || "(missing)"}, found ${current}; the board changed after it was opened`,
      );
    }
    await this.dir.writeText(id, body);
    const after = await this.dir.stat(id);
    return { revision: after ? revisionOf(after) : current };
  }

  /** Rename inside its own folder, keeping `.excalidraw`; a taken name gets the
   * next free "-n" (Rust `rename_board`). Returns the new id (its path). */
  async rename(id: string, name: string): Promise<{ id: string }> {
    assertBoardId(id);
    if (!(await this.dir.exists(id))) throw new Error(`board not found: ${id}`);
    const folder = parentPath(id);
    const desired = `${boardNameStem(name)}${BOARD_EXT}`;
    const exact = joinVaultPath(folder, desired);
    if (exact === id) return { id };
    // a case-only rename targets the board itself, never a "-2" sibling
    const target =
      exact.toLowerCase() === id.toLowerCase()
        ? exact
        : await freeVaultPath(this.dir, folder, desired, boardCollision);
    await this.dir.move(id, target);
    return { id: target };
  }
}
