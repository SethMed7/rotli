// Rotli Web: the in-memory notes service, persisted to the browser vault.
// The desktop shell never loads this path (see ./notes.ts for the switch).
//
// The writer is honest about three things a browser vault can get wrong
// (review 2026-09-16): it writes only what THIS tab changed (an untouched
// tab closing must not overwrite a sibling tab's notes), it presents the
// revision it hydrated from so a foreign change stops it instead of being
// clobbered, and a failed write is reported and retried rather than swallowed
// while the editor believes the note is saved.

import { type BrowserVault, RevisionConflict, browserVault } from "../lib/browserVault";
import { createDebouncedTask } from "../lib/debouncedTask";
import { showFileNotice } from "../state/fileNotice";
import { DEST } from "./destinations";
import { type InMemoryNotesService, isNotesSnapshot } from "./inMemoryNotes";
import type { NotesService } from "./notesPort";

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

/** The one web notes service: the in-memory service wrapped so every
 * mutation schedules a vault write. Called once from ./notes.ts. */
export function webNotesService(inner: InMemoryNotesService): NotesService {
  instance = createWebNotesPersistence(inner, browserVault(), showFileNotice);
  instance.attach();
  return instance.service;
}

/** Rotli Web only: restore the browser vault's notes before the first render
 * (main.tsx awaits it). Resolves false on a first visit, which is how the app
 * knows to seed and open the Welcome folder. A no-op elsewhere. */
export async function hydrateWebNotes(): Promise<boolean> {
  if (!instance) return false;
  return (await instance.hydrate()) === "restored";
}

/** True after hydrateWebNotes found a stored vault; false on a first visit. */
export function webVaultWasRestored(): boolean {
  return instance?.restored() ?? false;
}

/** Empty Trash for the browser vault: hard-delete and persist; the count. */
export function purgeWebTrash(): Promise<number> {
  return instance ? instance.purgeTrash() : Promise.resolve(0);
}
