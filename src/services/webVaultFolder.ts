// Rotli Web, folder mode: the user picks a real folder on this computer and
// the browser remembers ONLY that (its directory handle, in IndexedDB). Every
// note, the Main tree, and settings then live in the folder — the same files
// the Mac app reads — and nothing else is kept in the browser.
//
// Chromium only (File System Access API). Permission is per origin and per
// visit: the browser grants it on the pick, and asks again next time with one
// click ("Reconnect"). Safari and Firefox have no picker; they keep the
// browser-storage vault and say so.

import { VAULT_STORE, openDatabase, requestToPromise } from "../lib/browserVault";

const HANDLE_KEY = "vault-handle";

export type FolderVaultStatus =
  | { kind: "unsupported" }
  | { kind: "none" }
  | { kind: "granted"; name: string; handle: FileSystemDirectoryHandle }
  | { kind: "prompt"; name: string; handle: FileSystemDirectoryHandle };

export function folderPickerSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export type FolderSupport =
  /** The File System Access API: a live folder, read and write. */
  | { kind: "live" }
  /** Brave ships the API switched off; one flag turns it on. */
  | { kind: "brave-off" }
  /** Firefox, Zen, Safari: a folder can be read once and copied in; Export gives it back. */
  | { kind: "import-only"; browser: string };

/** What this browser can do with a folder, decided from what the page can
 * see synchronously. Brave hides behind a Chromium user agent but exposes a
 * `navigator.brave` object; its presence is the tell. */
export function browserFolderSupportSync(): FolderSupport {
  if (folderPickerSupported()) return { kind: "live" };
  if ("brave" in navigator) return { kind: "brave-off" };
  const ua = navigator.userAgent;
  const browser = /Zen\//.test(ua)
    ? "Zen"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Safari\//.test(ua) && !/Chrom/.test(ua)
        ? "Safari"
        : "this browser";
  return { kind: "import-only", browser };
}

export async function loadVaultHandle(key = HANDLE_KEY): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDatabase();
    const value = await requestToPromise(
      db.transaction(VAULT_STORE, "readonly").objectStore(VAULT_STORE).get(key),
    );
    return value && typeof value === "object" && "kind" in value
      ? (value as FileSystemDirectoryHandle)
      : null;
  } catch {
    return null;
  }
}

async function saveVaultHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  // a folder handle has no stable id of its own: this browser mints one per
  // chosen folder, so per-vault bookkeeping never crosses into another — and
  // choosing the SAME folder again keeps its id (and so its unsaved journal)
  // (the folder just closed with Change vault counts: it is kept as "previous")
  const previous = handle
    ? ((await loadVaultHandle()) ?? (await loadVaultHandle(PREVIOUS_HANDLE_KEY)))
    : null;
  const same = previous ? await handle?.isSameEntry(previous).catch(() => false) : false;
  const current = handle ? null : await loadVaultHandle();
  const db = await openDatabase();
  const store = db.transaction(VAULT_STORE, "readwrite").objectStore(VAULT_STORE);
  if (handle) {
    await requestToPromise(store.put(handle, HANDLE_KEY));
    if (!same) await requestToPromise(store.put(crypto.randomUUID(), FOLDER_ID_KEY));
  } else {
    if (current) await requestToPromise(store.put(current, PREVIOUS_HANDLE_KEY));
    await requestToPromise(store.delete(HANDLE_KEY));
  }
}

const PREVIOUS_HANDLE_KEY = "vault-handle-previous";

const FOLDER_ID_KEY = "vault-folder-id";

/** This browser's id for the remembered folder (minted if an older build
 * saved the handle without one). */
export async function vaultFolderId(): Promise<string> {
  const db = await openDatabase();
  const read = db.transaction(VAULT_STORE, "readonly").objectStore(VAULT_STORE);
  const known: unknown = await requestToPromise(read.get(FOLDER_ID_KEY));
  if (typeof known === "string" && known) return known;
  const minted = crypto.randomUUID();
  const write = db.transaction(VAULT_STORE, "readwrite").objectStore(VAULT_STORE);
  await requestToPromise(write.put(minted, FOLDER_ID_KEY));
  return minted;
}

/** Where the web build stands at boot: no picker, no folder, a folder the
 * browser still trusts, or one that needs a click before it may be read. */
export async function folderVaultStatus(): Promise<FolderVaultStatus> {
  if (!folderPickerSupported()) return { kind: "unsupported" };
  const handle = await loadVaultHandle();
  if (!handle) return { kind: "none" };
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return permission === "granted"
    ? { kind: "granted", name: handle.name, handle }
    : { kind: "prompt", name: handle.name, handle };
}

/** Pick a folder (a user gesture must call this), remember it, and reload so
 * the app boots from it. */
export async function connectFolderVault(): Promise<void> {
  if (!window.showDirectoryPicker)
    throw new Error("This browser can't connect a vault live. Chrome, Edge, or Arc can.");
  const handle = await window.showDirectoryPicker({ id: "rotli-vault", mode: "readwrite" });
  await saveVaultHandle(handle);
  window.location.reload();
}

/** Ask the browser for the remembered folder again (a user gesture) and reload. */
export async function reconnectFolderVault(): Promise<boolean> {
  const handle = await loadVaultHandle();
  if (!handle) return false;
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") return false;
  window.location.reload();
  return true;
}

/** Forget the folder (setup asks again after the reload). The folder itself
 * is untouched. */
export async function disconnectFolderVault(): Promise<void> {
  await saveVaultHandle(null);
  window.location.reload();
}
