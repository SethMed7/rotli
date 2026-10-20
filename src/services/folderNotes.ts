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

import { metadataLinkTargets } from "../graph/linkTargets";
import { bodyEdit } from "../lib/aiEditPolicy";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { isSkippedDir } from "../lib/fileKind";
import {
  composeNoteDocument,
  parseNoteDocument,
  withShelf,
  isLockedFrontmatter,
  isSecureFrontmatter,
} from "../lib/frontmatter";
import { rotliMade, withTopLevelLine } from "../lib/frontmatterInPlace";
import type { MemexContractRaw } from "../lib/tauri";
import { composeNote, noteStem, stampToMs, today, ulid } from "../memex/contract";
import type { NoteCreationPolicy } from "../security/secureNotes";
import type { Folder, Note, NoteSummary, SearchHit } from "../types";
import { snippetOf, summaryOrder, titleOf } from "./derive";
import {
  DEST,
  isChats,
  isHidden,
  isRootMarker,
  isSink,
  isTrash,
  isVault,
  reservedFolders,
  setFolderRoles,
} from "./destinations";
import { BOARD_LANE } from "./folderBoards";
import { isCanvasFile } from "./folderCanvases";
import { renameFolderFile } from "./folderFileRename";
import { folderFileSummary } from "./folderFileSummary";
import {
  assertSafeStem,
  ignoreInGit,
  isSecureNote,
  memexNoteFolder,
  readMemexContract,
  removeGitExclusion,
} from "./folderMemexNotes";
import { folderNoteAliases, prepareFolderTitleRename } from "./folderNoteAliases";
import {
  WIKI,
  WIKI_INBOX,
  WIKI_SECURE,
  diskDirFor,
  projectVaultFolder,
  relocationTarget,
  under,
  withoutSinkPrefix,
} from "./folderNoteRelocation";
import { movedNoteText, ownedNoteFacts, savedNoteText } from "./folderNoteStamps";
import type { NotesService } from "./notesPort";
import { searchMatch, sortHits } from "./search";
import {
  type VaultDir,
  contentRevision,
  baseName,
  freeVaultPath,
  joinVaultPath,
  parentPath,
  vaultFolderRoles,
  vaultOpenedInPlace,
  vaultIsMemex,
} from "./vaultDir";

/** Every non-Markdown surface is addressed by its file path, never note
 * frontmatter or a text-index entry. */
const isPathItem = (path: string) => !path.toLowerCase().endsWith(".md");

/** Disk roots that hold notes in a memex vault. Everything else — `.rotli/`,
 * dotfiles and the `identity/ personality/ history/`
 * knowledge spine — is deliberately outside the note universe. */
const MEMEX_NOTE_ROOTS = ["wiki", "chats", "archive", "trash"] as const;
/** Roots a PLAIN folder never walks, so a vault holding a memex spine without a `wiki/` keeps
 * those files out of the note list (chats/ is indexed; All notes hides it via isChats). */
const SKIPPED_ROOTS = new Set(["identity", "personality", "history"]);
/** Root files an imported vault hides (Rust `surfaced_imported`). */
const ROOT_CONTROL_FILES = new Set(["memex.json", "users.json", "memex.local.json", "identities.local.json"]);

/** Cached bytes for one file, keyed by the revision they were read at. */
interface CachedFile {
  revision: string;
  text: string;
}

export class FolderNotesService implements NotesService {
  private index: Map<string, string> | null = null;
  private readonly cache = new Map<string, CachedFile>();
  private isMemex = false;
  /** Opened in place (no marker, or one saying `inPlace`): notes stay as written. */
  private inPlace = false;
  /** An imported copy (slice 4): every note keeps its file name, so the
   * person's Obsidian `[[File name]]` links still resolve. */
  private imported = false;

  constructor(private readonly dir: VaultDir) {}

  /** The memex-root marker set used by the All-Notes chats/ exclusion. A memex
   * vault's default root is the bare "" marker; a plain folder has none. */
  private memexMarkers(): ReadonlySet<string> {
    return new Set(this.isMemex || this.imported ? [""] : []);
  }

  private async ensureIndex(): Promise<Map<string, string>> {
    if (this.index) return this.index;
    return this.rebuildIndex();
  }

  private async rebuildIndex(): Promise<Map<string, string>> {
    // an imported vault's tree is the person's: its wiki/ is no memex spine,
    // its identity/ or history/ no reserved root, its Archive/ no sink
    const [roles, memexShape, inPlace] = await Promise.all([
      vaultFolderRoles(this.dir),
      vaultIsMemex(this.dir),
      vaultOpenedInPlace(this.dir),
    ]);
    setFolderRoles(roles);
    this.imported = roles !== null;
    this.isMemex = !this.imported && memexShape;
    this.inPlace = inPlace;
    const paths: string[] = [];
    if (this.isMemex) {
      for (const root of MEMEX_NOTE_ROOTS) await this.collect(root, paths);
      // Storage binaries are file rows; only the board lane admits Markdown.
      const lane: string[] = [];
      await this.collect("storage", lane);
      paths.push(...lane.filter((path) => isPathItem(path) || path.startsWith(`${BOARD_LANE}/`)));
    } else {
      await this.collect("", paths, !this.imported);
    }
    const index = new Map<string, string>();
    for (const path of paths) {
      if (isPathItem(path)) {
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
      // an imported vault's marker files are Rust-hidden control files
      if (this.imported && path === "" && ROOT_CONTROL_FILES.has(entry.name)) continue;
      const child = joinVaultPath(path, entry.name);
      if (entry.kind === "directory") {
        if (isSkippedDir(entry.name) || (isRoot && SKIPPED_ROOTS.has(entry.name))) continue;
        await this.collect(child, out);
      } else if (!isCanvasFile(child) || LAUNCH_FEATURES.jsonCanvas) out.push(child);
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

  private async writeFile(path: string, text: string, expectedContent?: string): Promise<void> {
    await this.dir.writeText(path, text, expectedContent);
    this.cache.delete(path);
  }

  private async noteAt(path: string): Promise<Note> {
    if (isPathItem(path)) return this.boardAt(path);
    const text = await this.readFile(path);
    const stat = await this.dir.stat(path);
    if (!stat) throw new Error(`unknown note: ${path}`);
    const { frontmatter, body } = parseNoteDocument(text);
    const title = titleOf(body);
    const diskFolderId = parentPath(path);
    const updatedAt = stampToMs(frontmatter?.updated, stat.lastModified) ?? stat.lastModified;
    const aliases = folderNoteAliases(path, title, frontmatter);
    return {
      id: frontmatter?.id || path,
      title,
      snippet: snippetOf(body),
      bodyEmpty: !body.trim(),
      aliases,
      folderId: projectVaultFolder(diskFolderId, frontmatter, this.isMemex),
      diskFolderId,
      createdAt: stampToMs(frontmatter?.created, stat.lastModified) ?? updatedAt,
      updatedAt,
      pinned: frontmatter?.pinned ?? false,
      kind: "note",
      secure:
        under(withoutSinkPrefix(path), WIKI_SECURE) ||
        (frontmatter ? isSecureFrontmatter(frontmatter) : false),
      locked: frontmatter ? isLockedFrontmatter(frontmatter) : false,
      aiBodyEdit: bodyEdit(frontmatter?.foreign ?? []),
      suggestedLinks: metadataLinkTargets((frontmatter?.foreign ?? []).join("\n")),
      body,
      revision: contentRevision(text),
    };
  }

  /** Files list by stat alone; content reads belong to their editing adapter.
   * Boards retain their kind, and every other non-Markdown surface is a file. */
  private async boardAt(path: string): Promise<Note> {
    return folderFileSummary(this.dir, path, this.isMemex, (folder) =>
      projectVaultFolder(folder, null, this.isMemex),
    );
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

  async listFolders(): Promise<Folder[]> {
    await this.ensureIndex();
    const folders: Folder[] = reservedFolders().map((id) => ({ id, name: id, parentId: null }));
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
      if (isSkippedDir(entry.name) || (isRoot && SKIPPED_ROOTS.has(entry.name))) continue;
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
    if (!path || isPathItem(path) || !(await this.dir.exists(path))) return null;
    return this.noteAt(path);
  }

  /** A brand-new note always lands in the capture staging area — `wiki/_inbox`
   * in a memex, the folder root in a plain vault — exactly like the Mac app,
   * whichever row the user was looking at. */
  async createNote(_folderId: string, body: string, policy?: NoteCreationPolicy): Promise<Note> {
    await this.ensureIndex();
    const title = titleOf(body);
    const id = ulid();
    const plain = this.imported ? DEST.inbox : "";
    const dir = policy?.secure && this.isMemex ? WIKI_SECURE : this.isMemex ? WIKI_INBOX : plain;
    const path = await this.freePath(dir, `${noteStem(title, id)}.md`);
    const text = composeNote(
      {
        id,
        title,
        // an imported vault's capture shelf would read every new note as a
        // capture on the Mac (Rust project_folder); there it is a plain note
        shelf: this.imported ? [] : [DEST.inbox],
        reach: [],
        ...(policy?.secure ? { secure: true } : {}),
        ...(policy?.createdBy ? { createdBy: policy.createdBy } : {}),
      },
      body,
      today(),
    );
    const protectedText = policy?.locked ? text.replace("\n---\n", "\nlocked: true\n---\n") : text;
    const exactBodyText = body && !body.endsWith("\n") ? protectedText.slice(0, -1) : protectedText;
    if (policy?.secure) await ignoreInGit(this.dir, path);
    await this.writeFile(path, exactBodyText);
    this.reindex(id, id, path);
    return this.noteAt(path);
  }

  // ─── the memex writer: Rotli Web's `memex_read_contract` / `memex_write_note` ─

  readMemexContract(): Promise<MemexContractRaw> {
    return readMemexContract(this.dir);
  }

  /** Rust `write_note_at` (rules in folderMemexNotes.ts): a note composed by
   * `writeNote` lands under a free `stem (n).md` name; returns its path. */
  async writeMemexNote(stem: string, contents: string): Promise<string> {
    assertSafeStem(stem);
    await this.ensureIndex();
    const path = await this.freePath(await memexNoteFolder(this.dir, contents, this.isMemex), `${stem}.md`);
    if (isSecureNote(contents)) await ignoreInGit(this.dir, path);
    await this.writeFile(path, contents);
    const id = parseNoteDocument(contents).frontmatter?.id || path;
    this.reindex(id, id, path);
    return path;
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
    if (isPathItem(path)) throw new Error(`not a note: ${id}`);
    const original = await this.readFile(path);
    const revision = contentRevision(original);
    const { frontmatter, body: currentBody } = parseNoteDocument(original);
    if (!expectedRevision || (expectedRevision !== revision && expectedBody !== currentBody)) {
      throw new Error(
        `revision conflict: expected ${expectedRevision || "(missing)"}, found ${revision}; the note changed after it was opened`,
      );
    }
    // A file with no fence stays fenceless: a plain Markdown vault must not
    // sprout frontmatter the moment Rotli saves it.
    const modified = (await this.dir.stat(path))?.lastModified;
    if (frontmatter && modified === undefined) throw new Error(`unknown note: ${path}`);
    const asWritten = this.inPlace && !rotliMade(frontmatter);
    const text = savedNoteText(original, currentBody, frontmatter, body, modified, asWritten);
    const rename =
      asWritten || this.imported
        ? { text, path }
        : await prepareFolderTitleRename(this.dir, path, text, titleOf(currentBody), titleOf(body));
    await this.writeFile(path, rename.text, revision);
    // moveFile carries a secure note's .gitignore line to the new name
    if (rename.path !== path) return this.moveFile(id, path, rename.path);
    const saved = await this.noteAt(path);
    if (saved.revision !== contentRevision(rename.text)) throw new Error(`revision conflict on ${path}`);
    this.reindex(id, saved.id, path);
    return saved;
  }

  async deleteNote(id: string): Promise<void> {
    const index = await this.ensureIndex();
    const path = index.get(id);
    if (!path) return;
    await this.dir.remove(path);
    this.cache.delete(path);
    index.delete(id);
  }

  /** Moving into Archive or Trash keeps the note's ORIGINAL path beneath the
   * sink (`trash/wiki/_inbox/a.md`), so restore is a prefix strip, and stamps
   * the `origin` breadcrumb with the row it came from. Leaving a sink clears
   * the breadcrumb. A move to a `wiki/**` folder is a physical move; a move to
   * any other projection rewrites the shelf line and leaves the file where it
   * is. Only `updateNote` advances a valid `updated`; a move fills a missing
   * stamp from the pre-move file time without changing an existing one. */
  async moveNote(id: string, targetFolder: string): Promise<Note> {
    const path = await this.pathOf(id);
    if (isPathItem(path)) return this.moveFile(id, path, relocationTarget(path, targetFolder, this.isMemex));
    const original = await this.readFile(path);
    const { frontmatter, body } = parseNoteDocument(original);
    if (!frontmatter) return this.moveFile(id, path, relocationTarget(path, targetFolder, this.isMemex));
    const modified = (await this.dir.stat(path))?.lastModified;
    if (modified === undefined) throw new Error(`unknown note: ${path}`);
    const asWritten = this.inPlace && !rotliMade(frontmatter);
    let next = asWritten ? frontmatter : ownedNoteFacts(frontmatter, modified, false);
    const folderId = projectVaultFolder(parentPath(path), frontmatter, this.isMemex);
    if (isSink(targetFolder) && !isSink(folderId)) next = { ...next, origin: folderId };
    else if (!isSink(targetFolder) && next.origin !== null) next = { ...next, origin: null };
    const toDisk = relocationTarget(path, targetFolder, this.isMemex);
    if (toDisk === path && !isSink(targetFolder) && diskDirFor(targetFolder, this.isMemex) === null) {
      next = withShelf(next, [targetFolder]);
    }
    const moved = movedNoteText(original, frontmatter, next, body, asWritten);
    if (moved !== null) await this.writeFile(path, moved, contentRevision(original));
    return this.moveFile(id, path, toDisk);
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
      const secure = !isPathItem(from) && ((await this.noteAt(from)).secure || under(from, WIKI_SECURE));
      if (secure) await ignoreInGit(this.dir, to);
      await this.dir.move(from, to);
      if (secure) await removeGitExclusion(this.dir, from).catch(() => undefined);
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
    // an imported vault's notes go back to the folder their origin names
    // (Rust relocate); the inbox when that folder is gone
    if (this.imported && !isPathItem(path)) {
      const origin = parseNoteDocument(await this.readFile(path)).frontmatter?.origin;
      const stripped = withoutSinkPrefix(path);
      const wanted = typeof origin === "string" ? origin : stripped !== path ? parentPath(stripped) : null;
      const home = wanted !== null && (await this.dir.exists(wanted)) ? wanted : DEST.inbox;
      return this.moveNote(id, home);
    }
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
    const original = isPathItem(path) ? null : await this.readFile(path);
    const { frontmatter, body } =
      original === null ? { frontmatter: null, body: "" } : parseNoteDocument(original);
    if (original !== null && frontmatter && frontmatter.origin !== null) {
      const text =
        this.inPlace && !rotliMade(frontmatter)
          ? withTopLevelLine(original, "origin", null)
          : composeNoteDocument({ ...frontmatter, origin: null }, body);
      await this.writeFile(path, text, contentRevision(original));
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
    return renameFolderFile(
      this.dir,
      path,
      name,
      id,
      async (from, to) => (await this.moveFile(id, from, to)).id,
    );
  }
}
