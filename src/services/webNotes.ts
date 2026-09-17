// Rotli Web: the in-memory notes service, persisted to the browser vault.
// The desktop shell never loads this path (see ./notes.ts for the switch).
//
// The writer is honest about three things a browser vault can get wrong
// (review 2026-09-16): it writes only what THIS tab changed (an untouched
// tab closing must not overwrite a sibling tab's notes), it presents the
// revision it hydrated from so a foreign change stops it instead of being
// clobbered, and a failed write is reported and retried rather than swallowed
// while the editor believes the note is saved.

import {
  browserVault,
  configureBrowserVault,
  RevisionConflict,
  setWebVaultName,
  type BrowserVault,
} from "../lib/browserVault";
import { createDebouncedTask } from "../lib/debouncedTask";
import { FolderVaultStore } from "../lib/folderVaultStore";
import { FsaVaultDir } from "../lib/fsaVaultDir";
import { showFileNotice } from "../state/fileNotice";
import { DEST } from "./destinations";
import { FolderNotesService } from "./folderNotes";
import {
  IMPORTED_VAULT_KEY,
  PersistedVaultDir,
  downloadVaultZip,
  isImportedVaultSnapshot,
  seedVaultDir,
} from "./importedVault";
import { type InMemoryNotesService, isNotesSnapshot } from "./inMemoryNotes";
import type { NotesService } from "./notesPort";
import type { VaultDir } from "./vaultDir";
import { folderVaultStatus } from "./webVaultFolder";

/** The NotesService methods that change state. Every other method is a read. */
const MUTATORS: ReadonlySet<keyof NotesService> = new Set<keyof NotesService>([
  "createFolder",
  "updateFolder",
  "deleteFolder",
  "createNote",
  "updateNote",
  "deleteNote",
  "moveNote",
  "archiveNote",
  "trashNote",
  "restoreNote",
  "renameFile",
]);

/** Wrap a service so every successful mutation reports once. Pure over the
 * port: reads pass straight through, failures propagate unchanged, and the
 * report fires only after the mutation resolved (a refused write persists
 * nothing new). Exported for tests. */
export function persistingNotesService(inner: NotesService, onMutation: () => void): NotesService {
  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function" || !MUTATORS.has(property as keyof NotesService)) return value;
      return async (...args: unknown[]) => {
        const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        onMutation();
        return result;
      };
    },
  });
}

export type RestoreOutcome = "restored" | "fresh" | "unreadable";

/** Restore a stored snapshot into the service. Nothing stored means a first
 * visit ("fresh"); a value that does not parse, or a newer version than this
 * build reads, is "unreadable" — the seed stays and the caller must NOT write
 * over what is there. Exported for tests. */
export function restoreNotesSnapshot(service: InMemoryNotesService, raw: string | undefined): RestoreOutcome {
  if (raw === undefined) return "fresh";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "unreadable";
  }
  if (!isNotesSnapshot(parsed)) return "unreadable";
  service.importSnapshot(parsed);
  return "restored";
}

const NOTES_KEY = "notes";
const SAVE_DEBOUNCE_MS = 500;

export interface WebNotesPersistence {
  service: NotesService;
  /** Restore before the first render; resolves the outcome. */
  hydrate: () => Promise<RestoreOutcome>;
  /** Write now if this tab changed anything (awaitable). */
  flush: () => Promise<void>;
  /** Hard-delete every note in Trash and persist; resolves the count. */
  purgeTrash: () => Promise<number>;
  /** Whether hydrate found a stored vault. */
  restored: () => boolean;
  /** True once writes have been switched off (foreign change, unreadable store). */
  disabled: () => boolean;
  /** pagehide / visibilitychange wiring for the page (idempotent). */
  attach: () => void;
}

/** The whole persistence policy over an injected vault and notifier, so it
 * is testable without IndexedDB or a window. */
export function createWebNotesPersistence(
  inner: InMemoryNotesService,
  vault: BrowserVault,
  notify: (message: string) => void,
): WebNotesPersistence {
  let dirty = false;
  let disabled = false;
  let restored = false;
  let revision = "0";
  let unloading = false;
  let attached = false;

  const write = async (): Promise<void> => {
    if (!dirty || disabled) return;
    try {
      revision = await vault.writeVersioned(NOTES_KEY, JSON.stringify(inner.exportSnapshot()), revision);
      dirty = false;
    } catch (error) {
      if (error instanceof RevisionConflict) {
        // another tab wrote the vault since this one loaded: stop, never clobber
        disabled = true;
        notify(
          "Your notes changed in another tab. Reload this page to keep editing; nothing here will be saved over it.",
        );
        return;
      }
      // storage refused (quota, private mode): keep dirty so the next
      // mutation or flush retries, and say so
      notify(
        `Couldn’t save to this browser’s storage — ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  };
  const saver = createDebouncedTask(SAVE_DEBOUNCE_MS, write);

  const onMutation = (): void => {
    dirty = true;
    const hidden = typeof document !== "undefined" && document.hidden;
    if (unloading || hidden) void saver.flush().catch(() => {});
    else saver.schedule();
  };

  const attach = (): void => {
    if (attached || typeof window === "undefined") return;
    attached = true;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void saver.flush().catch(() => {});
    });
    window.addEventListener("pagehide", () => {
      unloading = true;
      void saver.flush().catch(() => {});
    });
    window.addEventListener("pageshow", () => {
      unloading = false;
    });
  };

  return {
    service: persistingNotesService(inner, onMutation),
    hydrate: async () => {
      let outcome: RestoreOutcome;
      try {
        const stored = await vault.readVersioned(NOTES_KEY);
        revision = stored.revision;
        outcome = restoreNotesSnapshot(inner, stored.contents === "" ? undefined : stored.contents);
      } catch {
        outcome = "unreadable";
      }
      restored = outcome === "restored";
      if (outcome === "unreadable") {
        disabled = true;
        notify(
          "The notes stored in this browser can’t be read by this version of Rotli. Nothing will be written over them.",
        );
      }
      return outcome;
    },
    flush: () => saver.flush(),
    purgeTrash: async () => {
      const trashed = await inner.listNotes(DEST.trash);
      for (const note of trashed) await inner.deleteNote(note.id);
      if (trashed.length > 0) {
        dirty = true;
        await saver.flush();
      }
      return trashed.length;
    },
    restored: () => restored,
    disabled: () => disabled,
    attach,
  };
}

// ─── the one instance for this page ────────────────────────────────────────

let instance: WebNotesPersistence | null = null;
/** Set at boot when the browser still trusts a remembered folder. */
let folderService: FolderNotesService | null = null;
let folderName: string | null = null;
let folderDir: VaultDir | null = null;
let mode: "browser" | "folder" | "imported" = "browser";
let importedAt: number | null = null;

/** The one web notes service: the in-memory service wrapped so every
 * mutation schedules a vault write. Called once from ./notes.ts. */
export function webNotesService(inner: InMemoryNotesService): NotesService {
  instance = createWebNotesPersistence(inner, browserVault(), showFileNotice);
  instance.attach();
  return instance.service;
}

/** Rotli Web only, before the first render (main.tsx awaits it). Folder mode
 * when the browser remembers a folder AND still trusts it: the notes service
 * and the `.rotli/` store switch to that folder and the browser vault is
 * never read. Otherwise the browser-storage vault restores; resolves false
 * on a first visit, which is how the app knows to seed Welcome. A no-op on
 * the desktop. */
export async function hydrateWebNotes(): Promise<boolean> {
  if (!instance) return false;
  const status = await folderVaultStatus();
  if (status.kind === "granted") {
    const dir = new FsaVaultDir(status.handle);
    configureBrowserVault(new FolderVaultStore(dir));
    folderService = new FolderNotesService(dir);
    folderName = status.name;
    setWebVaultName(status.name);
    folderDir = dir;
    mode = "folder";
    return true; // a real vault is never seeded over
  }
  if (status.kind === "prompt") {
    showFileNotice(
      `Your vault “${status.name}” needs permission again — Reconnect at the top of the sidebar`,
    );
  }
  // an imported copy (browsers without the live API): the same filesystem
  // in memory, mirrored back into browser storage on every change
  const idb = browserVault();
  const raw = await idb.read(IMPORTED_VAULT_KEY).catch(() => undefined);
  if (raw !== undefined) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (isImportedVaultSnapshot(parsed)) {
      const dir = new PersistedVaultDir(
        await seedVaultDir(parsed),
        parsed.name,
        (snapshot) => idb.write(IMPORTED_VAULT_KEY, snapshot),
        undefined,
        parsed.importedAt,
      );
      importedAt = parsed.importedAt ?? null;
      if (typeof window !== "undefined") {
        const flush = () => void dir.flush().catch(() => {});
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) flush();
        });
        window.addEventListener("pagehide", flush);
      }
      configureBrowserVault(new FolderVaultStore(dir));
      folderService = new FolderNotesService(dir);
      folderName = parsed.name;
      setWebVaultName(parsed.name);
      folderDir = dir;
      mode = "imported";
      return true;
    }
    showFileNotice(
      "The imported vault stored in this browser can’t be read by this version of Rotli; it was left alone.",
    );
  }
  return (await instance.hydrate()) === "restored";
}

/** The service the web build uses after hydrateWebNotes: the folder's when
 * connected, else the persisted in-memory one. */
export function activeWebNotesService(fallback: NotesService): NotesService {
  return folderService ?? fallback;
}

/** The connected folder's name, or null when notes live in the browser. */
/** The vault-relative file behind a note, in folder or imported mode; null
 * when the notes live only in the browser (nothing on disk to reveal). */
export async function webNoteFilePath(id: string): Promise<string | null> {
  if (!folderService) return null;
  return folderService.filePathOf(id).catch(() => null);
}

/** The connected (or imported) folder's directory port; null in browser mode. */
export function activeWebVaultDir(): VaultDir | null {
  return folderDir;
}

export function connectedFolderName(): string | null {
  return folderName;
}

/** Where this web session's notes live. */
export function webVaultMode(): "browser" | "folder" | "imported" {
  return mode;
}

/** When the imported copy was taken — null outside imported mode or for a
 * copy from before the stamp existed. */
function importedVaultAt(): number | null {
  return importedAt;
}

/** A copy younger than this says nothing about itself. */
const COPY_AGE_NOTICE_MS = 12 * 3_600_000;

/** The connected copy's age for the sidebar: null outside imported mode;
 * `old` once the copy is half a day old, or when it predates the stamp. */
export function importedCopyAge(now = Date.now()): { at: number | null; old: boolean } | null {
  if (mode !== "imported") return null;
  const at = importedVaultAt();
  return { at, old: at === null || now - at >= COPY_AGE_NOTICE_MS };
}

/** Download the connected or imported vault's text files as a zip. */
export async function exportWebVault(): Promise<void> {
  if (!folderDir) throw new Error("Nothing to export yet — open or import a folder first.");
  await downloadVaultZip(folderDir, folderName ?? "rotli-vault");
}

/** True after hydrateWebNotes found a stored vault (or a connected folder);
 * false on a first visit. */
export function webVaultWasRestored(): boolean {
  return folderService !== null || (instance?.restored() ?? false);
}

/** Empty Trash for the browser-storage vault: hard-delete and persist; the
 * count. In folder mode the caller deletes through the notes service itself
 * (null says so). */
export function purgeWebTrash(): Promise<number | null> {
  if (folderService) return Promise.resolve(null);
  return instance ? instance.purgeTrash() : Promise.resolve(0);
}
