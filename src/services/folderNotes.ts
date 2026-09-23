// The NotesService over a REAL vault folder. Rotli Web hands it a VaultDir
// backed by the File System Access API; tests hand it MemoryVaultDir. Every
// rule the Mac app enforces in Rust (the projection table, the origin
// breadcrumb, the revision conflict, the rename refusal) is mirrored here so
// the same folder behaves the same in both shells.
//
// Markdown files are the truth. Nothing is stored beside them: ids, shelves,
// and lifecycle all live in the note's own frontmatter. Boards (`.excalidraw`)
// are listed and moved here the way the Mac corpus lists them — id = path, no
// frontmatter, never read to be indexed; their scene I/O is folderBoards.ts.

import { extOf, fileName, fileNameStem, userFileName } from "../lib/fileKind";
import {
  type NoteFrontmatter,
  composeNoteDocument,
  parseNoteDocument,
  shelfOf,
  withShelf,
  isSecureFrontmatter,
} from "../lib/frontmatter";
import type { MemexContractRaw } from "../lib/tauri";
import { composeNote, noteSlugify, noteStem, today, ulid } from "../memex/contract";
import type { NoteCreationPolicy } from "../security/secureNotes";
import type { Folder, Note, NoteSummary, SearchHit } from "../types";
import { snippetOf, summaryOrder, titleOf } from "./derive";
import { DEST, isChats, isHidden, isRootMarker, isSink, isTrash, isVault } from "./destinations";
import { BOARD_LANE, boardTitle, isBoardPath } from "./folderBoards";
import type { NotesService } from "./notesPort";
import { searchMatch, sortHits } from "./search";
import { type VaultDir, baseName, freeVaultPath, joinVaultPath, parentPath, vaultIsMemex } from "./vaultDir";

/** Disk roots that hold notes in a memex vault. Everything else — `.rotli/`,
 * dotfiles, `chats/` transcripts, and the `identity/ personality/ history/`
 * knowledge spine — is deliberately outside the note universe. */
const MEMEX_NOTE_ROOTS = ["wiki", "chats", "archive", "trash"] as const;
/** Roots a PLAIN folder never walks, so a vault that happens to hold a memex
 * spine without a `wiki/` still keeps those files out of the note list. */
// chats/ is indexed (the Library shows it; All notes still hides it through
// isChats); the memory lanes stay out of the note universe
const SKIPPED_ROOTS = new Set(["identity", "personality", "history", "node_modules"]);
const WIKI = "wiki";
const WIKI_INBOX = "wiki/_inbox";
const WIKI_SECURE = "wiki/_secure";
/** The vault's settings file: its `brainEnabled` is the Librarian switch. */
const SETTINGS_FILE = ".rotli/settings.json";
/** The disk name of each never-delete sink, in projection order. */
const SINK_DIRS: { dir: string; dest: string }[] = [
  { dir: "archive", dest: DEST.archive },
  { dir: "trash", dest: DEST.trash },
];
/** Reserved destination rows: id === name, no parent — the same grammar the
 * in-memory service seeds, so `DEST.inbox === folder.id` holds in every mode. */
const RESERVED_FOLDERS = [DEST.inbox, DEST.secure, DEST.storage, DEST.board, DEST.archive, DEST.trash];

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** Cached bytes for one file, keyed by the revision they were read at. */
interface CachedFile {
  revision: string;
  text: string;
}

/** The folder a note is PROJECTED into — the row the sidebar shows, which in a
 * memex differs from the physical directory. A path-based table:
 *
 * • `archive` / `trash` and their subtrees → the reserved Archive / Trash rows.
 * • `wiki/_inbox` → Board (the Captures row).
 * • `wiki/_secure` → Board when the note is shelved to Inbox (a quick capture
 *   is secure at birth but is still a capture), otherwise the Secure spine.
 * • any other `wiki/<path>` → that path; `wiki` itself → "wiki".
 * • a plain vault projects the physical directory, with the root as Inbox.
 *
 * Deliberate divergences from Rust `project_folder`, which the browser build's
 * folder list requires: Rust keeps the suffix (`Archive/wiki/ideas`) where this
 * flattens to `Archive`, and Rust projects a shelved `wiki/**` note onto its
 * primary shelf where this keeps the disk path, because `listFolders` here
 * offers the wiki tree rather than a shelf vocabulary. */
export function projectVaultFolder(
  diskFolderId: string,
  fm: NoteFrontmatter | null,
  isMemex: boolean,
): string {
  if (!isMemex) return diskFolderId === "" ? DEST.inbox : diskFolderId;
  for (const sink of SINK_DIRS) if (under(diskFolderId, sink.dir)) return sink.dest;
  if (under(diskFolderId, WIKI_INBOX)) return DEST.board;
  if (under(diskFolderId, WIKI_SECURE)) {
    return fm && shelfOf(fm).includes(DEST.inbox) ? DEST.board : WIKI_SECURE;
  }
  return diskFolderId;
}

/** The physical directory a move target names, or null when the target is a
 * projection with no disk home (a shelf name) and only the shelf line moves. */
function diskDirFor(folderId: string, isMemex: boolean): string | null {
  if (!isMemex) return folderId === DEST.inbox ? "" : folderId;
  if (folderId === DEST.board) return WIKI_INBOX;
  if (under(folderId, WIKI)) return folderId;
  return null;
}

/** A sink-relative path with its `archive/`/`trash/` prefix removed, so a note
 * moved between sinks never nests one inside the other. */
function withoutSinkPrefix(path: string): string {
  for (const sink of SINK_DIRS) {
    if (path.startsWith(`${sink.dir}/`)) return path.slice(sink.dir.length + 1);
  }
  return path;
}

const dateOrNull = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

export class FolderNotesService implements NotesService {
  private index: Map<string, string> | null = null;
  private readonly cache = new Map<string, CachedFile>();
  private isMemex = false;

  constructor(private readonly dir: VaultDir) {}

  // ─── layout, walking, and the id index ─────────────────────────────────────

  /** The memex-root marker set used by the All-Notes chats/ exclusion. A memex
   * vault's default root is the bare "" marker; a plain folder has none. */
  private memexMarkers(): ReadonlySet<string> {
    return new Set(this.isMemex ? [""] : []);
  }

  private async ensureIndex(): Promise<Map<string, string>> {
    if (this.index) return this.index;
    return this.rebuildIndex();
  }

  private async rebuildIndex(): Promise<Map<string, string>> {
    this.isMemex = await vaultIsMemex(this.dir);
    const paths: string[] = [];
    if (this.isMemex) {
      for (const root of MEMEX_NOTE_ROOTS) await this.collect(root, paths);
      // the board lane lists boards only; the rest of storage/ stays out
      const lane: string[] = [];
      await this.collect(BOARD_LANE, lane);
      paths.push(...lane.filter(isBoardPath));
    } else {
      await this.collect("", paths, true);
    }
    const index = new Map<string, string>();
    for (const path of paths) {
      if (isBoardPath(path)) {
        index.set(path, path);
        continue;
      }
      const fm = parseNoteDocument(await this.readFile(path)).frontmatter;
      index.set(fm?.id || path, path);
    }
    this.index = index;
    return index;
  }

  private async collect(path: string, out: string[], isRoot = false): Promise<void> {
    for (const entry of await this.dir.list(path)) {
      if (entry.name.startsWith(".")) continue;
      const child = joinVaultPath(path, entry.name);
      if (entry.kind === "directory") {
        if (isRoot && SKIPPED_ROOTS.has(entry.name)) continue;
        await this.collect(child, out);
      } else if (entry.name.toLowerCase().endsWith(".md") || isBoardPath(entry.name)) out.push(child);
    }
  }

  /** Read a file through the revision cache: unchanged bytes are never re-read. */
  private async readFile(path: string): Promise<string> {
    const stat = await this.dir.stat(path);
    if (!stat) throw new Error(`unknown note: ${path}`);
    const revision = `${stat.lastModified}:${stat.size}`;
    const cached = this.cache.get(path);
    if (cached && cached.revision === revision) return cached.text;
    const text = await this.dir.readText(path);
    this.cache.set(path, { revision, text });
    return text;
  }

  private async writeFile(path: string, text: string): Promise<void> {
    await this.dir.writeText(path, text);
    this.cache.delete(path);
  }

  private async noteAt(path: string): Promise<Note> {
    if (isBoardPath(path)) return this.boardAt(path);
    const text = await this.readFile(path);
    const stat = await this.dir.stat(path);
    if (!stat) throw new Error(`unknown note: ${path}`);
    const { frontmatter, body } = parseNoteDocument(text);
    const title = titleOf(body);
    const diskFolderId = parentPath(path);
    const updatedAt = dateOrNull(frontmatter?.updated) ?? stat.lastModified;
    const aliases = [...new Set([fileNameStem(path), noteSlugify(title)].filter(Boolean))];
    return {
      id: frontmatter?.id || path,
      title,
      snippet: snippetOf(body),
      bodyEmpty: !body.trim(),
      aliases,
      folderId: projectVaultFolder(diskFolderId, frontmatter, this.isMemex),
      diskFolderId,
      createdAt: dateOrNull(frontmatter?.created) ?? updatedAt,
      updatedAt,
      pinned: frontmatter?.pinned ?? false,
      kind: "note",
      secure: frontmatter ? isSecureFrontmatter(frontmatter) : false,
      body,
      revision: `${stat.lastModified}:${stat.size}`,
    };
  }

  /** A board's row. The scene is never read to list it (Rust lists boards by
   * stat alone), so `body` is empty — board content goes through folderBoards. */
  private async boardAt(path: string): Promise<Note> {
    const stat = await this.dir.stat(path);
    if (!stat) throw new Error(`unknown board: ${path}`);
    const diskFolderId = parentPath(path);
    return {
      id: path,
      title: boardTitle(path),
      snippet: "",
      bodyEmpty: false,
      aliases: [],
      folderId: projectVaultFolder(diskFolderId, null, this.isMemex),
      diskFolderId,
      createdAt: stat.lastModified,
      updatedAt: stat.lastModified,
      pinned: false,
      kind: "board",
      secure: false,
      body: "",
      revision: `${stat.lastModified}:${stat.size}`,
    };
  }

  /** The vault-relative file behind a note id — what a Finder reveal needs. */
  filePathOf(id: string): Promise<string> {
    return this.pathOf(id);
  }

  private async pathOf(id: string): Promise<string> {
    const index = await this.ensureIndex();
    const path = index.get(id);
    if (!path) throw new Error(`unknown note: ${id}`);
    return path;
  }

  /** Point an id at a new path, dropping any id it replaced. A note whose file
   * carries no frontmatter `id` is identified BY its path, so moving or
   * renaming it changes its id — the caller receives the new one on the Note. */
  private reindex(oldId: string, newId: string, path: string): void {
    const index = this.index;
    if (!index) return;
    if (oldId !== newId) index.delete(oldId);
    index.set(newId, path);
  }

  // ─── folders ───────────────────────────────────────────────────────────────

  async listFolders(): Promise<Folder[]> {
    await this.ensureIndex();
    const folders: Folder[] = RESERVED_FOLDERS.map((id) => ({ id, name: id, parentId: null }));
    const root = this.isMemex ? WIKI : "";
    if (this.isMemex && (await this.dir.exists(WIKI))) {
      folders.push({ id: WIKI, name: WIKI, parentId: null });
    }
    const dirs: string[] = [];
    await this.collectDirs(root, dirs, !this.isMemex);
    for (const path of dirs) {
      const parent = parentPath(path);
      folders.push({ id: path, name: baseName(path), parentId: parent === "" ? null : parent });
    }
    return folders;
  }

  private async collectDirs(path: string, out: string[], isRoot = false): Promise<void> {
    for (const entry of await this.dir.list(path)) {
      if (entry.kind !== "directory" || entry.name.startsWith(".")) continue;
      if (isRoot && SKIPPED_ROOTS.has(entry.name)) continue;
      const child = joinVaultPath(path, entry.name);
      out.push(child);
      await this.collectDirs(child, out);
    }
  }

  async createFolder(name: string, parentId: string | null = null): Promise<Folder> {
    await this.ensureIndex();
    const base = parentId ?? (this.isMemex ? WIKI : "");
    const path = joinVaultPath(base, name);
    if (!path) throw new Error("a folder needs a name");
    await this.dir.mkdir(path);
    return { id: path, name, parentId: parentId ?? (this.isMemex ? WIKI : null) };
  }

  /** Renaming a folder on disk means moving every note inside it, which would
   * churn the id of every frontmatter-less file beneath it. Until that move is
   * a first-class workflow, only an EMPTY folder renames; a full one refuses
   * loudly rather than half-moving a tree. */
  async updateFolder(id: string, name: string): Promise<Folder> {
    const children = await this.dir.list(id);
    if (children.length > 0) {
      throw new Error(
        `“${baseName(id)}” isn't empty — renaming a folder with notes in it isn't supported yet`,
      );
    }
    const parent = parentPath(id);
    const path = joinVaultPath(parent, name);
    await this.dir.mkdir(path);
    await this.dir.remove(id);
    return { id: path, name, parentId: parent === "" ? null : parent };
  }

  async deleteFolder(id: string): Promise<void> {
    const children = await this.dir.list(id);
    if (children.length > 0) throw new Error(`“${baseName(id)}” isn't empty`);
    await this.dir.remove(id);
  }

  // ─── listing and search ────────────────────────────────────────────────────

  async listAll(): Promise<NoteSummary[]> {
    const index = await this.rebuildIndex();
    const notes: NoteSummary[] = [];
    for (const path of new Set(index.values())) {
      const { body: _body, ...summary } = await this.noteAt(path);
      notes.push(summary);
    }
    return notes;
  }

  /** The same three-case scoping rule the in-memory service and the disk
   * adapter share (destinations.ts is the truth): All Notes hides the hidden
   * roots, the external Vault, and chats/ transcripts; a hidden root shows only
   * its own subtree; any normal folder shows its subtree minus hidden. */
  async listNotes(folderId?: string): Promise<NoteSummary[]> {
    const all = await this.listAll();
    const memex = this.memexMarkers();
    let scoped: NoteSummary[];
    if (!folderId) {
      scoped = all.filter(
        (n) => !isHidden(n.folderId) && !isVault(n.folderId) && !isChats(n.folderId, memex),
      );
    } else if (isRootMarker(folderId)) {
      scoped = all.filter((n) => n.folderId.startsWith(folderId));
    } else if (isHidden(folderId)) {
      scoped = all.filter((n) => under(n.folderId, folderId));
    } else {
      scoped = all.filter((n) => !isHidden(n.folderId) && under(n.folderId, folderId));
    }
    return scoped.sort(summaryOrder);
  }

  /** The same scope and grammar as Rust `corpus_search`: never Trash, never
   * chats/ (Archive and captures stay findable), ranked by search.ts. */
  async searchNotes(query: string, limit = 50): Promise<SearchHit[]> {
    if (!query.trim()) return [];
    const index = await this.rebuildIndex();
    const memex = this.memexMarkers();
    const hits: SearchHit[] = [];
    for (const path of new Set(index.values())) {
      const note = await this.noteAt(path);
      if (isTrash(note.folderId) || isChats(note.folderId, memex)) continue;
      const match = searchMatch(query, note.title, note.body, note.snippet);
      if (!match) continue;
      hits.push({
        id: note.id,
        title: note.title,
        snippet: match.snippet,
        folderId: note.folderId,
        kind: note.kind ?? "note",
        rank: match.rank,
        matchStart: match.matchStart,
        matchLen: match.matchLen,
        spans: match.spans,
        updatedAt: note.updatedAt,
      });
    }
    return sortHits(hits).slice(0, limit);
  }

  async getNote(id: string): Promise<Note | null> {
    if (!id) return null;
    const index = await this.ensureIndex();
    const path = index.get(id);
    // a board is not a note: its scene is read through folderBoards
    if (!path || isBoardPath(path) || !(await this.dir.exists(path))) return null;
    return this.noteAt(path);
  }

  // ─── writes ────────────────────────────────────────────────────────────────

  /** A brand-new note always lands in the capture staging area — `wiki/_inbox`
   * in a memex, the folder root in a plain vault — exactly like the Mac app,
   * whichever row the user was looking at. */
  async createNote(_folderId: string, body: string, policy?: NoteCreationPolicy): Promise<Note> {
    await this.ensureIndex();
    const title = titleOf(body);
    const id = ulid();
    const dir = this.isMemex ? WIKI_INBOX : "";
    const path = await this.freePath(dir, `${noteStem(title, id)}.md`);
    const text = composeNote(
      { id, title, shelf: [DEST.inbox], reach: [], ...(policy?.secure ? { secure: true } : {}) },
      body,
      today(),
    );
    await this.writeFile(path, text);
    this.reindex(id, id, path);
    return this.noteAt(path);
  }

  // ─── the memex writer: Rotli Web's `memex_read_contract` / `memex_write_note` ─

  /** Rust `memex_read_contract`: the vault's contract files, "" when missing. */
  async readMemexContract(): Promise<MemexContractRaw> {
    const read = async (path: string) => ((await this.dir.exists(path)) ? this.dir.readText(path) : "");
    return {
      memexJson: await read("memex.json"),
      usersJson: await read("users.json"),
      identitiesJson: await read("identities.local.json"),
    };
  }

  /** Rust `write_note_at`: a note composed by `writeNote` (memex/service.ts)
   * lands in `wiki/_secure` when its frontmatter says `secure: true`, else in
   * `wiki/_inbox` while the Librarian is on (`.rotli/settings.json`
   * `brainEnabled`, default on), else at the `wiki/` root — under a free
   * `stem (n).md` name, a secure one also listed in `.gitignore`. A plain
   * folder has no `wiki/`, so its notes land at its root. Returns the
   * vault-relative path. */
  async writeMemexNote(stem: string, contents: string): Promise<string> {
    if (!/^[a-z0-9-]{1,80}$/.test(stem)) throw new Error(`unsafe note stem: ${JSON.stringify(stem)}`);
    await this.ensureIndex();
    const { frontmatter } = parseNoteDocument(contents);
    const secure = frontmatter ? isSecureFrontmatter(frontmatter) : false;
    const dir = !this.isMemex
      ? ""
      : secure
        ? WIKI_SECURE
        : (await this.librarianEnabled())
          ? WIKI_INBOX
          : WIKI;
    const path = await this.freePath(dir, `${stem}.md`);
    if (secure) await this.ignoreInGit(path);
    await this.writeFile(path, contents);
    const id = frontmatter?.id || path;
    this.reindex(id, id, path);
    return path;
  }

  private async librarianEnabled(): Promise<boolean> {
    if (!(await this.dir.exists(SETTINGS_FILE))) return true;
    try {
      const value = (JSON.parse(await this.dir.readText(SETTINGS_FILE)) as { brainEnabled?: unknown })
        .brainEnabled;
      return typeof value === "boolean" ? value : true;
    } catch {
      return true; // malformed settings keep the established default, as in Rust
    }
  }

  private async ignoreInGit(path: string): Promise<void> {
    const existing = (await this.dir.exists(".gitignore")) ? await this.dir.readText(".gitignore") : "";
    if (existing.split("\n").some((line) => line.trim() === path)) return;
    const lead = existing && !existing.endsWith("\n") ? "\n" : "";
    await this.dir.writeText(".gitignore", `${existing}${lead}${path}\n`);
  }

  /** `name.md`, then `name (2).md`, `name (3).md`, … — existing numbers are
   * never renumbered, matching the Rust staging filename rule. The one place
   * a filename is chosen, so neither creation nor a lifecycle move can land on
   * a sibling that is already there. */
  private freePath(dir: string, name: string): Promise<string> {
    return freeVaultPath(this.dir, dir, name, (stem, ext, n) => `${stem} (${n})${ext}`);
  }

  async updateNote(id: string, body: string, expectedRevision: string, expectedBody?: string): Promise<Note> {
    const path = await this.pathOf(id);
    if (isBoardPath(path)) throw new Error(`not a note: ${id}`);
    const current = await this.noteAt(path);
    if (!expectedRevision || (expectedRevision !== current.revision && expectedBody !== current.body)) {
      throw new Error(
        `revision conflict: expected ${expectedRevision || "(missing)"}, found ${current.revision}; the note changed after it was opened`,
      );
    }
    const { frontmatter } = parseNoteDocument(await this.readFile(path));
    // A file with no fence stays fenceless: a plain Markdown vault must not
    // sprout frontmatter the moment Rotli saves it.
    const text = frontmatter ? composeNoteDocument({ ...frontmatter, updated: today() }, body) : body;
    await this.writeFile(path, text);
    return this.noteAt(path);
  }

  async deleteNote(id: string): Promise<void> {
    const index = await this.ensureIndex();
    const path = index.get(id);
    if (!path) return;
    await this.dir.remove(path);
    this.cache.delete(path);
    index.delete(id);
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────────

  /** Moving into Archive or Trash keeps the note's ORIGINAL path beneath the
   * sink (`trash/wiki/_inbox/a.md`), so restore is a prefix strip, and stamps
   * the `origin` breadcrumb with the row it came from. Leaving a sink clears
   * the breadcrumb. A move to a `wiki/**` folder is a physical move; a move to
   * any other projection rewrites the shelf line and leaves the file where it
   * is. Only `updateNote` stamps `updated` — a move never does. */
  async moveNote(id: string, targetFolder: string): Promise<Note> {
    const path = await this.pathOf(id);
    if (isBoardPath(path)) return this.moveFile(id, path, this.targetPath(path, targetFolder));
    const current = await this.noteAt(path);
    const { frontmatter, body } = parseNoteDocument(await this.readFile(path));
    if (!frontmatter) return this.moveFile(id, path, this.targetPath(path, targetFolder));
    let next = frontmatter;
    if (isSink(targetFolder) && !isSink(current.folderId)) next = { ...next, origin: current.folderId };
    else if (!isSink(targetFolder) && next.origin !== null) next = { ...next, origin: null };
    const toDisk = this.targetPath(path, targetFolder);
    if (toDisk === path && !isSink(targetFolder) && diskDirFor(targetFolder, this.isMemex) === null) {
      next = withShelf(next, [targetFolder]);
    }
    // an untouched frontmatter is never rewritten: a plain wiki -> wiki move
    // must not normalize a hand-authored file for no reason
    if (next !== frontmatter) await this.writeFile(path, composeNoteDocument(next, body));
    return this.moveFile(id, path, toDisk);
  }

  /** Where `targetFolder` puts the file: beneath a sink with the original path
   * preserved, inside the named `wiki/**` directory, or nowhere at all. */
  private targetPath(path: string, targetFolder: string): string {
    for (const sink of SINK_DIRS) {
      if (under(targetFolder, sink.dest)) return joinVaultPath(sink.dir, withoutSinkPrefix(path));
    }
    const dir = diskDirFor(targetFolder, this.isMemex);
    return dir === null ? path : joinVaultPath(dir, baseName(path));
  }

  /** The one file relocation. A target a sibling already holds gets the next
   * free ` (n)` name instead of overwriting it — two same-named notes trashed
   * in turn must both survive in the sink. A case-only rename targets its own
   * file and is left alone. */
  private async moveFile(id: string, from: string, target: string): Promise<Note> {
    let to = target;
    if (to !== from) {
      if (to.toLowerCase() !== from.toLowerCase() && (await this.dir.exists(to))) {
        to = await this.freePath(parentPath(to), baseName(to));
      }
      await this.dir.move(from, to);
      this.cache.delete(from);
      this.cache.delete(to);
    }
    const note = await this.noteAt(to);
    this.reindex(id, note.id, to);
    return note;
  }

  async archiveNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.archive);
  }

  async trashNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.trash);
  }

  /** Send it back where it came from: the sink keeps the original path, so the
   * prefix strip IS the restore. When that directory no longer exists the note
   * lands in the capture staging area instead of recreating a dead tree. */
  async restoreNote(id: string): Promise<Note> {
    const path = await this.pathOf(id);
    const original = withoutSinkPrefix(path);
    if (original === path) return this.clearOrigin(id, path);
    const home = parentPath(original);
    const target = (await this.dir.exists(home))
      ? original
      : joinVaultPath(this.isMemex ? WIKI_INBOX : "", baseName(original));
    await this.clearOrigin(id, path);
    return this.moveFile(id, path, target);
  }

  private async clearOrigin(id: string, path: string): Promise<Note> {
    const { frontmatter, body } = isBoardPath(path)
      ? { frontmatter: null, body: "" }
      : parseNoteDocument(await this.readFile(path));
    if (frontmatter && frontmatter.origin !== null) {
      await this.writeFile(path, composeNoteDocument({ ...frontmatter, origin: null }, body));
    }
    const note = await this.noteAt(path);
    this.reindex(id, note.id, path);
    return note;
  }

  /** Rename the file inside its own directory, keeping the extension. Refuses a
   * name a sibling already holds, with the same message the in-memory twin and
   * the Rust command use. */
  async renameFile(id: string, name: string): Promise<string> {
    const path = await this.pathOf(id);
    const next = userFileName(name, extOf(fileName(path)));
    const newPath = joinVaultPath(parentPath(path), next);
    if (newPath === path) return id;
    if (newPath.toLowerCase() !== path.toLowerCase() && (await this.dir.exists(newPath))) {
      throw new Error(`a file named “${next}” already exists here`);
    }
    const note = await this.moveFile(id, path, newPath);
    return note.id;
  }
}
