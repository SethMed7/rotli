// The data seam. All note/folder access goes through this typed interface,
// and the bottom of this file is the ONE switch point: inside the Tauri shell
// the markdown corpus on disk is the truth (FsNotesService); in a plain
// browser (vite dev, design review) the seeded in-memory service remains.
// Components never call either directly — they consume the TanStack Query
// hooks in ./hooks.ts.

import { isTauri } from "../lib/tauri";
import type { Folder, Note, NoteSummary } from "../types";
import { DEST, isHidden, isRootMarker, isSink, isVault } from "./destinations";
import { snippetOf, titleOf } from "./derive";
import { FsNotesService } from "./fsNotes";

export interface NotesService {
  listFolders(): Promise<Folder[]>;
  createFolder(name: string, parentId?: string | null): Promise<Folder>;
  updateFolder(id: string, name: string): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  /** No folderId = all notes. With a folderId, includes descendant folders
   * (one mental model: a folder holds everything under it). */
  listNotes(folderId?: string): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(folderId: string, body: string): Promise<Note>;
  updateNote(id: string, body: string): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  // ——— lifecycle (Phase 2c): the note keeps its id/index, only its home moves.
  // archive/trash/restore are move with the origin rule applied; restore reads
  // the recorded origin and falls back to Inbox if it's gone (Seth, 2026-06-13).
  moveNote(id: string, targetFolder: string): Promise<Note>;
  archiveNote(id: string): Promise<Note>;
  trashNote(id: string): Promise<Note>;
  restoreNote(id: string): Promise<Note>;
}

/** Ulid-style id: time-sortable prefix + random tail (Crockford base32). */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = (B32[t % 32] ?? "0") + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += B32[Math.floor(Math.random() * 32)] ?? "0";
  return time + rand;
}

export class InMemoryNotesService implements NotesService {
  private folders = new Map<string, Folder>();
  private notes = new Map<string, Note>();
  /** Where an archived/trashed note came from, so Phase 2 restore is
   * reviewable in the browser surface — fs mode carries this on disk instead.
   * Side Map keeps Note's shape identical to the FS service (Seth, 2026-06-13). */
  readonly origins = new Map<string, string>();

  async listFolders(): Promise<Folder[]> {
    return [...this.folders.values()];
  }

  async createFolder(name: string, parentId: string | null = null): Promise<Folder> {
    const folder: Folder = { id: ulid(), name, parentId };
    this.folders.set(folder.id, folder);
    return folder;
  }

  async updateFolder(id: string, name: string): Promise<Folder> {
    const existing = this.folders.get(id);
    if (!existing) throw new Error(`unknown folder: ${id}`);
    const updated = { ...existing, name };
    this.folders.set(id, updated);
    return updated;
  }

  async deleteFolder(id: string): Promise<void> {
    this.folders.delete(id);
  }

  private descendants(folderId: string): Set<string> {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of this.folders.values()) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  async listNotes(folderId?: string): Promise<NoteSummary[]> {
    const all = [...this.notes.values()];
    // Same three-case rule as FsNotesService (destinations.ts is the truth):
    // All Notes hides the hidden roots; a hidden root shows only its subtree;
    // any normal folder shows its subtree minus hidden (defensive).
    // A non-default ROOT MARKER ("vault:") scopes to the whole external root by
    // id prefix (its folders aren't in the descendants() parent-graph). Handle it
    // before the parent-graph cases so the browser mirror matches fs mode.
    if (folderId && isRootMarker(folderId)) {
      return all
        .filter((n) => n.folderId.startsWith(folderId))
        .map(({ body: _body, ...summary }) => summary)
        .sort((a, b) =>
          a.pinned !== b.pinned
            ? a.pinned
              ? -1
              : 1
            : b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
    }
    const within = folderId ? this.descendants(folderId) : null; // once, not per note
    let scoped: Note[];
    // All Notes also excludes the external Vault — browsed only via its own row.
    if (!within) scoped = all.filter((n) => !isHidden(n.folderId) && !isVault(n.folderId));
    else if (folderId && isHidden(folderId))
      scoped = all.filter((n) => within.has(n.folderId));
    else scoped = all.filter((n) => within.has(n.folderId) && !isHidden(n.folderId));
    return scoped
      .map(({ body: _body, ...summary }) => summary)
      .sort((a, b) =>
        a.pinned !== b.pinned
          ? a.pinned
            ? -1
            : 1
          : b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  async getNote(id: string): Promise<Note | null> {
    return this.notes.get(id) ?? null;
  }

  async createNote(folderId: string, body: string): Promise<Note> {
    // mirror fs mode's safety ceiling: rotli never creates a note inside the
    // external Vault (the memex is read-mostly; corpus_create's writable() gate
    // refuses it in the shell). Keeps the browser preview honest.
    if (isVault(folderId)) throw new Error("the Vault is read-only — notes can't be created there");
    const now = Date.now();
    const note: Note = {
      id: ulid(now),
      title: titleOf(body),
      snippet: snippetOf(body),
      folderId,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      body,
    };
    this.notes.set(note.id, note);
    return note;
  }

  async updateNote(id: string, body: string): Promise<Note> {
    const existing = this.notes.get(id);
    if (!existing) throw new Error(`unknown note: ${id}`);
    const updated: Note = {
      ...existing,
      body,
      title: titleOf(body),
      snippet: snippetOf(body),
      updatedAt: Date.now(),
    };
    this.notes.set(id, updated);
    return updated;
  }

  async deleteNote(id: string): Promise<void> {
    this.notes.delete(id);
  }

  // ——— lifecycle: move keeps the note's id; only its folderId changes. The
  // origin Map mirrors fs mode's on-disk breadcrumb so restore is reviewable in
  // the browser surface, while the Note's shape stays identical to fs mode —
  // origin is NEVER a field on Note (Seth, 2026-06-13). ———

  async moveNote(id: string, targetFolder: string): Promise<Note> {
    const existing = this.notes.get(id);
    if (!existing) throw new Error(`unknown note: ${id}`);
    // mirror Rust's cross-root refusal: a note can't move into the external
    // Vault (or out of it, but that path can't arise in browser mode).
    if (isVault(targetFolder)) throw new Error("moving a note into the Vault isn't supported");
    const from = existing.folderId;
    // The SAME origin rule Rust bakes in (isSink mirrors Rust is_hidden_root —
    // Archive/Trash only, NOT Board): entering a sink from a non-sink folder
    // records where it came from; leaving a sink when an origin exists clears
    // it; otherwise the breadcrumb is left untouched.
    if (isSink(targetFolder) && !isSink(from)) this.origins.set(id, from);
    else if (!isSink(targetFolder) && this.origins.has(id)) this.origins.delete(id);
    const updated: Note = { ...existing, folderId: targetFolder };
    this.notes.set(id, updated);
    return updated;
  }

  async archiveNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.archive);
  }

  async trashNote(id: string): Promise<Note> {
    return this.moveNote(id, DEST.trash);
  }

  async restoreNote(id: string): Promise<Note> {
    // Mirror fs mode's three-valued origin (corpus.rs:162-167): no breadcrumb →
    // Inbox; "" → the corpus ROOT (a distinct value, NOT a miss); a folder id →
    // there if it still exists, else Inbox. "" is falsy and no folder has id "",
    // so the root case must be matched explicitly.
    const origin = this.origins.get(id);
    const target =
      origin === undefined
        ? DEST.inbox
        : origin === "" || this.folders.has(origin)
          ? origin
          : DEST.inbox;
    return this.moveNote(id, target);
  }

  /** Synchronous seeding (Stage 1 sample corpus — the r1/r2 gate frames). */
  seedFolder(name: string, parentId: string | null = null): Folder {
    const folder: Folder = { id: ulid(), name, parentId };
    this.folders.set(folder.id, folder);
    return folder;
  }

  /** A reserved/destination folder whose id IS its name (or its path under a
   * reserved root, e.g. "Storage/Work", or a prefixed external-root path like
   * "vault:wiki") — matching fs mode where folderId === the relative path (bare
   * for the default root, "<rootid>:rel" for a non-default one). This is what
   * makes DEST.inbox === folder.id true in BOTH modes; the freshest-note and
   * destination lookups depend on it. */
  seedReserved(id: string, name: string, parentId: string | null = null): Folder {
    const folder: Folder = { id, name, parentId };
    this.folders.set(folder.id, folder);
    return folder;
  }

  seedNote(
    folderId: string,
    body: string,
    opts: { id?: string; pinned?: boolean; createdAt: number; updatedAt: number; origin?: string },
  ): Note {
    const note: Note = {
      id: opts.id ?? ulid(opts.createdAt),
      title: titleOf(body),
      snippet: snippetOf(body),
      folderId,
      createdAt: opts.createdAt,
      updatedAt: opts.updatedAt,
      pinned: opts.pinned ?? false,
      body,
    };
    this.notes.set(note.id, note);
    if (opts.origin) this.origins.set(note.id, opts.origin);
    return note;
  }
}

// ——— the seeded corpus (titles/snippets from the approved gate frames) ———
// Browser/dev surface ONLY: inside the Tauri shell the demo corpus never even
// exists in memory — the disk corpus (with its one welcome note) is the truth.

/** ONE switch point — decided once, at startup. */
const FS_MODE = isTauri();

// Dev-only review affordance: ?empty skips note seeding so the r1 frame E
// empty state ("Your island is ready") can be looked at. Folders still exist —
// Inbox is the capture target either way.
const SEED_EMPTY =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("empty");

const svc = new InMemoryNotesService();

// fs mode: folder ids ARE relative paths; "Inbox" is born on first run
let inboxId = "Inbox";
let firstNoteId = "";

if (!FS_MODE) {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const todayAt = (h: number, m: number) => {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return Math.min(d.getTime(), now);
  };

  // Reserved LOCAL roots: id === name (mirrors fs mode where folderId is the
  // path), so DEST.inbox === folder.id holds in the browser too.
  const inbox = svc.seedReserved(DEST.inbox, DEST.inbox);
  inboxId = inbox.id;
  svc.seedReserved(DEST.storage, DEST.storage);
  svc.seedReserved(DEST.board, DEST.board);
  svc.seedReserved(DEST.archive, DEST.archive);
  svc.seedReserved(DEST.trash, DEST.trash);

  // The external Vault root (mirrors fs mode's memex auto-bind to ~/smBrain): a
  // non-default root whose surfaced folders carry the "vault:" prefix. Only
  // wiki/ (browse-only) + chats/ surface — self/history/etc never do. The Vault
  // row itself is the marker DEST.vault ("vault:"); these are its top-level
  // folders (parentId === null, exactly as Rust aggregates them).
  svc.seedReserved("vault:wiki", "wiki", null);
  svc.seedReserved("vault:chats", "chats", null);
  // A nested wiki subfolder so the tree + descendant scoping render like fs mode.
  const vaultProjects = svc.seedReserved("vault:wiki/projects", "projects", "vault:wiki");

  // A couple of LOCAL user folders under Storage — path-style ids so the tree
  // renders and descendant scoping behaves exactly like fs mode.
  const storageWork = svc.seedReserved(`${DEST.storage}/Work`, "Work", DEST.storage);
  const storageMyela = svc.seedReserved(`${DEST.storage}/Myela`, "Myela", DEST.storage);

  if (!SEED_EMPTY) {
    // —— Inbox: the welcome note + a quick capture ——
    const welcome = svc.seedNote(
      inbox.id,
      `# rotli — notes first

Apple Notes feel, **markdown underneath**. Local files, one structure the AI can read. The app is a *visitor* — summon it, write, dismiss it.

### What ships first

- [x] Folders, list, editor — the three panes
- [ ] Quick capture from anywhere (\`⌥Space\`)
- [ ] Plain \`.md\` files on disk — the corpus

> The folder of files *is* the product. Every view, every backend, every AI is a reader.

Later: breve plugs into the same corpus and the Wiki answers from it. Nothing changes shape.`,
      { createdAt: todayAt(9, 42), updatedAt: todayAt(9, 42) },
    );
    firstNoteId = welcome.id;

    svc.seedNote(
      inbox.id,
      `# Call the bank about the wire limit before Friday`,
      { createdAt: now - 2 * DAY, updatedAt: now - 2 * DAY },
    );

    // —— Storage: a pinned decision + nested Work/Myela notes ——
    svc.seedNote(
      DEST.storage,
      `# Pricing decision

Free local forever. Paid = sync + managed AI. Never gate local features behind the subscription — the corpus is the user's, full stop.

Launch sync at $4, anchor on Obsidian, revisit at 10k users.`,
      { pinned: true, createdAt: todayAt(8, 5), updatedAt: todayAt(9, 10) },
    );

    svc.seedNote(
      storageWork.id,
      `# Q3 platform review — prep

Three things must land before Thursday: the settlement mapping, the gateway export enum, and a clear pricing answer we can defend in front of the partners.

The demo flows from capture → recall: open with the island story, close with the cited answer.

Maria owns the reconciliation walkthrough; I take pricing.`,
      { createdAt: now - DAY, updatedAt: now - DAY },
    );

    svc.seedNote(
      storageMyela.id,
      `# Q3 priorities — Myela

Ship the gateway migration, land the issuing portal rebuild, and get the partner reporting story straight before the platform review.`,
      { createdAt: todayAt(7, 30), updatedAt: todayAt(7, 30) },
    );

    // —— Vault (external memex, browse-only): wiki/ notes that rotli reads but
    // never writes. These mirror what surfaces from ~/smBrain — note-creation is
    // redirected to the local Inbox, never into here. ——
    svc.seedNote(
      "vault:wiki",
      `# smBrain — the knowledge base

The durable, human-readable memory. rotli browses it read-only: wiki/ surfaces here, self/ and history/ never do.`,
      { createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY },
    );

    svc.seedNote(
      vaultProjects.id,
      `# rotli — project note

The warm, local-first menu-bar notes app. Lives in its own repo; the Vault is where its long-form thinking is kept.`,
      { createdAt: now - 5 * DAY, updatedAt: now - 5 * DAY },
    );

    // —— a plain local "Brain" folder: the Brain→Vault rename leaves the
    // pre-existing local folder untouched (Invariant 4) — it's just a folder now.
    const localBrain = svc.seedFolder("Brain");

    // —— Storage: long-lived reference ——
    svc.seedNote(
      DEST.storage,
      `# Quokka world — where it lives

Onboarding, empty states, about. Never in the editor, never in notifications — the world appears at low-frequency moments only.`,
      { createdAt: now - DAY, updatedAt: now - DAY },
    );

    svc.seedNote(
      DEST.storage,
      `# Groceries

Olive oil, sourdough, oat milk, blueberries, the good butter.`,
      { createdAt: now - 4 * DAY, updatedAt: now - 4 * DAY },
    );

    // —— ONE Archive note + ONE Trash note (origin = where restore returns it).
    // These are hidden from All Notes; only their own view shows them. ——
    svc.seedNote(
      DEST.archive,
      `# 1-on-1 — Sarah

Ship review Friday. She'll own the gateway migration writeup. Follow up on the Lithic question and the Q3 growth path conversation.`,
      {
        createdAt: now - 30 * DAY,
        updatedAt: now - 7 * DAY,
        origin: `${DEST.storage}/Work`,
      },
    );

    svc.seedNote(
      DEST.trash,
      `# Old draft — pricing tiers v0

Scrap this. The three-tier idea died; we went free-local + one paid sync line. Kept only so Phase 2 restore has something to put back.`,
      {
        createdAt: now - 14 * DAY,
        updatedAt: now - 5 * DAY,
        origin: localBrain.id,
      },
    );

    // —— Board: loose quick-captures, the staging area. Cards, not notes — you
    // multi-select and merge them into one joint note (Seth, 2026-06-19). ——
    svc.seedNote(DEST.board, "Ask Maria about the settlement mapping deadline", {
      createdAt: now - 40 * 60 * 1000,
      updatedAt: now - 40 * 60 * 1000,
    });
    svc.seedNote(DEST.board, "Idea: warm empty-state for the Board — the quokka again?", {
      createdAt: now - 25 * 60 * 1000,
      updatedAt: now - 25 * 60 * 1000,
    });
    svc.seedNote(DEST.board, "Gateway export enum — confirm the Lithic mapping before Thursday", {
      createdAt: now - 8 * 60 * 1000,
      updatedAt: now - 8 * 60 * 1000,
    });
  }
}

/** Where captures and ⌘N land when no folder is selected — "Inbox" on disk
 * (fs mode), the seeded folder's id in the browser. */
export const inboxFolderId = inboxId;

/** The note the window opens on (gate frame A); "" when nothing is known at
 * startup — fs mode resolves the freshest note async (App.tsx fills the
 * pristine first tab once the corpus answers). */
export const initialNoteId = firstNoteId;

export const notesService: NotesService = FS_MODE ? new FsNotesService() : svc;
