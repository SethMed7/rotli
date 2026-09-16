// Rotli Web: the in-memory notes service, persisted to the browser vault.
// The desktop shell never loads this path (see ./notes.ts for the switch).

import { browserVault } from "../lib/browserVault";
import { createDebouncedTask } from "../lib/debouncedTask";
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

/** Restore a stored snapshot into the service. A missing or malformed value
 * leaves the fresh seed in place and reports false; a newer version is
 * refused the same way rather than being read as version 1. Exported for tests. */
export function restoreNotesSnapshot(service: InMemoryNotesService, raw: string | undefined): boolean {
  if (raw === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isNotesSnapshot(parsed)) return false;
  service.importSnapshot(parsed);
  return true;
}

const WEB_NOTES_KEY = "notes";
let webVaultRestored = false;

let service: InMemoryNotesService | null = null;
const webSaver = createDebouncedTask(500, () => {
  if (!service) return;
  return browserVault().write(WEB_NOTES_KEY, JSON.stringify(service.exportSnapshot()));
});
/** Set by pagehide. A reload or navigation fires pagehide WITHOUT a
 * visibilitychange, and the editor's own pagehide flush lands its pending
 * save a microtask later than our listener runs — so a mutation that arrives
 * while unloading must write immediately, never through the debounce. */
let unloading = false;

/** Debounced while the tab is visible; immediate once it is hidden or
 * unloading, because a debounce would fire after the page is gone. */
function scheduleWebSave(): void {
  const hidden = typeof document !== "undefined" && document.hidden;
  if (unloading || hidden) void webSaver.flush().catch(() => {});
  else webSaver.schedule();
}

function attachFlushes(): void {
  if (typeof window === "undefined") return;
  // The same flush discipline as state/persist.ts: a hidden or unloading tab
  // writes now, so a note typed seconds before closing is not lost.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void webSaver.flush().catch(() => {});
  });
  window.addEventListener("pagehide", () => {
    unloading = true;
    void webSaver.flush().catch(() => {});
  });
  window.addEventListener("pageshow", () => {
    unloading = false; // back-forward cache restored the page
  });
}

/** Rotli Web only: restore the browser vault's notes before the first render
 * (main.tsx awaits it). Resolves false on a first visit, which is how the app
 * knows to seed and open the Welcome folder. A no-op elsewhere. */
export async function hydrateWebNotes(): Promise<boolean> {
  if (!service) return false;
  try {
    webVaultRestored = restoreNotesSnapshot(service, await browserVault().read(WEB_NOTES_KEY));
  } catch {
    webVaultRestored = false;
  }
  return webVaultRestored;
}

/** True after hydrateWebNotes found a stored vault; false on a first visit. */
export function webVaultWasRestored(): boolean {
  return webVaultRestored;
}

/** The one web notes service: the in-memory service wrapped so every
 * mutation schedules a vault write. Called once from ./notes.ts. */
export function webNotesService(inner: InMemoryNotesService): NotesService {
  service = inner;
  attachFlushes();
  return persistingNotesService(inner, scheduleWebSave);
}
