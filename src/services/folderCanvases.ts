// Canvases in a real vault folder — the Rotli Web twin of the Mac app's
// canvas file commands (corpus_files.rs `create_canvas`, plus the file read
// and revision-checked write the editor uses). A canvas is a raw `.canvas`
// file like a board: no frontmatter, its id IS its vault-relative path, and
// it never joins the note index (folderNotes lists it by path alone).

import { EMPTY_CANVAS_FILE } from "../jsonCanvas/model";
import { DEST } from "./destinations";
import { type VaultDir, type VaultStat, freeVaultPath, normalizeVaultPath, vaultIsMemex } from "./vaultDir";

const CANVAS_EXT = ".canvas";
const RESERVED = new Set<string>(Object.values(DEST));

export function isCanvasFile(path: string): boolean {
  return path.toLowerCase().endsWith(CANVAS_EXT);
}

/** A canvas's display title: its file name without `.canvas`. */
export function canvasTitle(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return isCanvasFile(name) && name.length > CANVAS_EXT.length ? name.slice(0, -CANVAS_EXT.length) : name;
}

/** Where a new canvas is written: beside notes in the folder the person was
 * in (owner decision 2026-10-06), else where a new note would land — a
 * memex's capture folder, a plain vault's root. The Mac's corpus_files.rs
 * `canvas_home` is the twin (parity entry `canvasHome`); a plain vault's
 * reserved lanes follow each side's own note rule. */
export function canvasHome(folderId: string, isMemex: boolean): string {
  const local = normalizeVaultPath(folderId.slice(folderId.indexOf(":") + 1));
  const under = (root: string) => local === root || local.startsWith(`${root}/`);
  if (isMemex) return under("wiki") ? local : "wiki/_inbox";
  return RESERVED.has(folderId) ? "" : local;
}

const revisionOf = (stat: VaultStat) => `${stat.lastModified}:${stat.size}`;
const collision = (stem: string, ext: string, n: number) => `${stem}-${n}${ext}`;

function assertCanvasId(id: string): void {
  if (!isCanvasFile(id)) throw new Error(`not a canvas: ${id}`);
  if (normalizeVaultPath(id) !== id || id.split("/").includes(".."))
    throw new Error(`invalid canvas path: ${id}`);
}

export class FolderCanvasStore {
  constructor(private readonly dir: VaultDir) {}

  /** Write a new, empty canvas at a free name; never replaces a file. */
  async create(folderId: string, name: string): Promise<string> {
    const stem = name.trim().replace(/[/\\]/g, "-").trim();
    if (!stem) throw new Error("a canvas needs a name");
    const home = canvasHome(folderId, await vaultIsMemex(this.dir));
    const id = await freeVaultPath(this.dir, home, `${stem}${CANVAS_EXT}`, collision);
    await this.dir.writeText(id, EMPTY_CANVAS_FILE);
    return id;
  }

  /** Its size and revision, or null when it isn't there. */
  async stat(id: string): Promise<{ len: number; revision: string } | null> {
    assertCanvasId(id);
    const stat = await this.dir.stat(id);
    return stat ? { len: stat.size, revision: revisionOf(stat) } : null;
  }

  /** The text, its size, and the revision a save must present — the stat
   * taken BEFORE the read, so a write in between can only make the next save
   * conflict, never overwrite a version the editor didn't see. */
  async read(id: string): Promise<{ text: string; len: number; revision: string } | null> {
    assertCanvasId(id);
    const stat = await this.dir.stat(id);
    if (!stat) return null;
    return { text: await this.dir.readText(id), len: stat.size, revision: revisionOf(stat) };
  }

  /** Save only over the version the editor loaded. */
  write(id: string, text: string, expectedRevision: string): Promise<string> {
    assertCanvasId(id);
    return oneAtATime(this.dir, id, async () => {
      const stat = await this.dir.stat(id);
      if (!stat) throw new Error(`canvas not found: ${id}`);
      const current = revisionOf(stat);
      if (expectedRevision !== current) {
        throw new Error("This canvas changed on disk since it was opened. Reopen it to keep editing.");
      }
      await this.dir.writeText(id, text);
      const after = await this.dir.stat(id);
      return after ? revisionOf(after) : current;
    });
  }
}

// A folder has no compare-and-swap, so a canvas's revision check and its
// write run back to back under one lock per file: two panes on one canvas
// can't both pass the check. Another tab or device can still write between
// them; that write turns this page's next save into a conflict.
const writing = new WeakMap<VaultDir, Map<string, Promise<unknown>>>();

function oneAtATime<T>(dir: VaultDir, id: string, work: () => Promise<T>): Promise<T> {
  let byId = writing.get(dir);
  if (!byId) writing.set(dir, (byId = new Map()));
  const queue = byId;
  const run = (queue.get(id) ?? Promise.resolve()).then(work, work);
  const settled = run.catch(() => {});
  queue.set(id, settled);
  void settled.then(() => {
    if (queue.get(id) === settled) queue.delete(id);
  });
  return run;
}
