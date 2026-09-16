// Rotli Web's vault: the browser's own storage standing in for the Rust corpus.
//
// In the desktop shell every durable byte goes through Tauri to plain files.
// Rotli Web (built with ROTLI_PLATFORM=web, served from the site under
// `connect-src 'none'`) has no shell, so the same seam functions in
// ./tauri.ts branch here instead: settings, viewstate, the Main and views
// manifests, and the notes snapshot all live in one IndexedDB key-value store
// on this device. Nothing here talks to a network; the page's CSP forbids it.
//
// Two things are deliberately NOT here: the notes data model (that stays in
// services/notes.ts' InMemoryNotesService, which already mirrors the Rust
// rules) and any policy about what the web build may show (featurePolicy).
// This file is a storage adapter and nothing else — the reason it is allowed
// to be effectful (scripts/source-ownership.ts LIB_EFFECTFUL_FILE_OWNERS).

import { PLATFORM } from "./featurePolicy";

/** The narrow port: string keys, string values, all-or-nothing writes. */
export interface VaultStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Write `value` under `key` and `nextRevision` under `revisionKey` only if
   * `revisionKey` currently holds `expectedRevision` (a missing key reads as
   * "0") — all in ONE transaction, so two writers cannot both pass the check.
   * Resolves false when the check failed and nothing was written. */
  compareAndSwap(
    key: string,
    value: string,
    revisionKey: string,
    expectedRevision: string,
    nextRevision: string,
  ): Promise<boolean>;
}

const DB_NAME = "rotli-web";
const DB_VERSION = 1;
const STORE = "vault";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked by another tab"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** The real store. One database, one object store, opened lazily once. */
export class IndexedDbVaultStore implements VaultStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= openDatabase();
    return this.db;
  }

  async get(key: string): Promise<string | undefined> {
    const db = await this.open();
    const value = await requestToPromise(db.transaction(STORE, "readonly").objectStore(STORE).get(key));
    return typeof value === "string" ? value : undefined;
  }

  async set(key: string, value: string): Promise<void> {
    const db = await this.open();
    await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key));
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(key));
  }

  compareAndSwap(
    key: string,
    value: string,
    revisionKey: string,
    expectedRevision: string,
    nextRevision: string,
  ): Promise<boolean> {
    return this.open().then(
      (db) =>
        new Promise<boolean>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          const store = tx.objectStore(STORE);
          let swapped = false;
          const read = store.get(revisionKey);
          read.onsuccess = () => {
            const current = typeof read.result === "string" ? read.result : "0";
            if (current !== expectedRevision) return; // the transaction commits nothing
            store.put(value, key);
            store.put(nextRevision, revisionKey);
            swapped = true;
          };
          tx.oncomplete = () => resolve(swapped);
          tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
          tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
        }),
    );
  }
}

/** For tests and for a browser without IndexedDB (private windows in some
 * engines): the session keeps working, nothing survives a reload. */
export class MemoryVaultStore implements VaultStore {
  readonly values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  async compareAndSwap(
    key: string,
    value: string,
    revisionKey: string,
    expectedRevision: string,
    nextRevision: string,
  ): Promise<boolean> {
    if ((this.values.get(revisionKey) ?? "0") !== expectedRevision) return false;
    this.values.set(key, value);
    this.values.set(revisionKey, nextRevision);
    return true;
  }
}

/** True in the web build only — the one switch ./tauri.ts consults. Settings
 * and URLs cannot flip it; the build chose the platform. */
export function isWebVault(): boolean {
  return PLATFORM === "web";
}

/** A revisioned text file (the Main/views manifests, settings): the same
 * optimistic-concurrency contract as `corpus_main_write` in Rust — a write
 * must present the revision it read, or it is refused. Revisions are per-key
 * counters stored beside the value. */
export interface VersionedValue {
  contents: string;
  revision: string;
}

export class BrowserVault {
  constructor(readonly store: VaultStore) {}

  async read(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async write(key: string, value: string): Promise<void> {
    await this.store.set(key, value);
  }

  async readVersioned(key: string): Promise<VersionedValue> {
    const contents = (await this.store.get(key)) ?? "";
    const revision = (await this.store.get(`${key}#rev`)) ?? "0";
    return { contents, revision };
  }

  /** Refuses a stale write; a first write must present revision "0". The
   * check and the write are one transaction (two tabs cannot both win). */
  async writeVersioned(key: string, contents: string, expectedRevision: string): Promise<string> {
    const next = String(Number(expectedRevision || "0") + 1);
    const swapped = await this.store.compareAndSwap(key, contents, `${key}#rev`, expectedRevision, next);
    if (!swapped) {
      const current = (await this.store.get(`${key}#rev`)) ?? "0";
      throw new RevisionConflict(key, expectedRevision, current);
    }
    return next;
  }
}

/** A write that presented a revision the store no longer holds: another tab
 * (or an earlier write in this one) moved it. Callers decide whether to
 * reload or to stop writing. */
export class RevisionConflict extends Error {
  constructor(
    readonly key: string,
    readonly expected: string,
    readonly found: string,
  ) {
    super(`revision conflict on ${key}: expected ${expected || "(missing)"}, found ${found}`);
    this.name = "RevisionConflict";
  }
}

function chooseStore(): VaultStore {
  if (typeof indexedDB === "undefined") return new MemoryVaultStore();
  return new IndexedDbVaultStore();
}

let vault: BrowserVault | null = null;

/** The one vault for this page. Created on first use so the desktop build,
 * which never calls it, never opens a database. */
export function browserVault(): BrowserVault {
  vault ??= new BrowserVault(chooseStore());
  return vault;
}
