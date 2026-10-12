// Browser-only office recovery. Editor models are captured synchronously as
// UTF-8/base64 on every change; the opened package bytes travel with them so
// replay can rebuild a conventional file without relying on an unload task.
// The vault file remains durable truth. This journal is temporary and bounded.

import { bytesFromBase64, bytesToBase64 } from "../lib/base64Bytes";
import { bytesRevision } from "../lib/contentRevision";
import { PLATFORM } from "../lib/featurePolicy";
import { assertVaultFilePath, folderWriteFileBytes } from "./folderFileIo";
import type { VaultDir } from "./vaultDir";
import { freeSiblingPath } from "./vaultDir";
import { webVaultKey } from "./webNotes";

export type OfficeDraftKind = "docx" | "xlsx" | "csv";
export interface OfficeDraft {
  fileId: string;
  kind: OfficeDraftKind;
  baseRevision: string;
  sourceBase64: string;
  snapshotBase64: string;
  sheetIdMap?: [string, number][];
  token: string;
  sessionId: string;
}
export type OfficeDraftInput = Omit<OfficeDraft, "token" | "sessionId"> & { sessionId?: string };
type SyncStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

// localStorage is commonly about 5 MiB for the whole origin. ASCII base64 may
// count as two UTF-16 bytes per character; at most 2.4 MiB leaves over half
// for notes, pending operations, settings, and browser overhead.
export const OFFICE_DRAFT_ENTRY_MAX_CHARS = 1_000_000;
export const OFFICE_DRAFT_TOTAL_MAX_CHARS = 1_200_000;
export const OFFICE_DRAFT_WARNING =
  "This change isn't protected until it saves. The browser's draft storage is full or this file is too large.";
const PREFIX = "rotli-office-unsaved:";
let serial = 0;
/** One browser-tab editing session; a refreshed tab gets a new slot. */
export const officeEditingSessionId = crypto.randomUUID();
const heldSessions = new Map<string, Promise<void>>();
const sessionLockName = (vault: string, sessionId: string) =>
  `rotli-office-session:${encodeURIComponent(vault)}:${encodeURIComponent(sessionId)}`;

/** A tab holds its session lock until the browser tears down the page. Boot
 * awaits acquisition before editors can create drafts under this session. */
export function holdOfficeEditingSession(vault: string): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return Promise.resolve();
  const name = sessionLockName(vault, officeEditingSessionId);
  const existing = heldSessions.get(name);
  if (existing) return existing;
  let acquired!: () => void;
  let failed!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    failed = reject;
  });
  heldSessions.set(name, ready);
  void locks
    .request(name, async () => {
      acquired();
      await new Promise<void>(() => {}); // page teardown releases the browser-owned lock
    })
    .catch(failed);
  return ready;
}

async function abandonedOfficeSession(vault: string, sessionId: string): Promise<boolean> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  // A browser without Web Locks cannot prove a peer is gone; leave its draft
  // intact. The supported folder/Helper browser roads both provide Web Locks.
  if (!locks) return false;
  return locks.request(sessionLockName(vault, sessionId), { ifAvailable: true }, (lock) => !!lock);
}

export const officeDraftKey = (vault: string): string => `${PREFIX}${vault}`;
const draftKey = (vault: string, draft: Pick<OfficeDraft, "sessionId" | "fileId">, kept = false) =>
  `${officeDraftKey(vault)}:${kept ? "kept" : "draft"}:${encodeURIComponent(draft.sessionId)}:${encodeURIComponent(draft.fileId)}`;

function valid(value: unknown): value is OfficeDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as OfficeDraft;
  return (
    typeof draft.fileId === "string" &&
    ["docx", "xlsx", "csv"].includes(draft.kind) &&
    typeof draft.baseRevision === "string" &&
    typeof draft.sourceBase64 === "string" &&
    typeof draft.snapshotBase64 === "string" &&
    (draft.sheetIdMap === undefined ||
      (Array.isArray(draft.sheetIdMap) &&
        draft.sheetIdMap.every(
          (entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number",
        ))) &&
    typeof draft.token === "string" &&
    typeof draft.sessionId === "string"
  );
}

function read(store: SyncStore, key: string): OfficeDraft | null {
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? "null");
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function draftKeys(store: SyncStore, vault: string): string[] {
  const prefix = `${officeDraftKey(vault)}:`;
  const keys: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(`${prefix}draft:`) || key?.startsWith(`${prefix}kept:`)) keys.push(key);
    }
  } catch {
    return []; // private-mode storage can refuse even enumeration
  }
  return keys;
}

export function readOfficeDrafts(store: SyncStore, vault: string): OfficeDraft[] {
  return draftKeys(store, vault)
    .map((key) => read(store, key))
    .filter((draft): draft is OfficeDraft => !!draft);
}

function totalDraftChars(store: SyncStore, vault: string): number {
  return draftKeys(store, vault).reduce(
    (total, key) => total + key.length + (store.getItem(key)?.length ?? 0),
    0,
  );
}

/** Returns false when storage is blocked or the latest edit exceeds the
 * budget. The older protected edit is left intact, and the editor warns. */
export function writeOfficeDraft(
  store: SyncStore,
  vault: string,
  input: OfficeDraftInput,
): { protected: boolean; token: string } {
  const sessionId = input.sessionId ?? officeEditingSessionId;
  const token = `${sessionId}:${Date.now()}:${++serial}`;
  try {
    assertVaultFilePath(input.fileId);
    const draft: OfficeDraft = { ...input, sessionId, token };
    const encoded = JSON.stringify(draft);
    if (encoded.length > OFFICE_DRAFT_ENTRY_MAX_CHARS) return { protected: false, token };
    const key = draftKey(vault, draft);
    const previous = store.getItem(key);
    if (
      totalDraftChars(store, vault) -
        (previous ? key.length + previous.length : 0) +
        key.length +
        encoded.length >
      OFFICE_DRAFT_TOTAL_MAX_CHARS
    )
      return { protected: false, token };
    store.setItem(key, encoded);
    // Tabs may journal at once. The post-write check keeps the shared budget
    // bounded when another session published between our read and write.
    if (totalDraftChars(store, vault) > OFFICE_DRAFT_TOTAL_MAX_CHARS) {
      if (previous === null) store.removeItem(key);
      else store.setItem(key, previous);
      return { protected: false, token };
    }
    return { protected: true, token };
  } catch {
    return { protected: false, token };
  }
}

/** A completed save may clear only the exact draft it started with. */
export function clearOfficeDraft(store: SyncStore, vault: string, fileId: string, token: string): void {
  for (const key of draftKeys(store, vault)) {
    const current = read(store, key);
    if (current?.fileId === fileId && current.token === token) store.removeItem(key);
  }
}

export function confirmWebOfficeSave(fileId: string, token: string): void {
  if (PLATFORM !== "web" || !token) return;
  const vault = webVaultKey();
  if (vault) clearOfficeDraft(window.localStorage, vault, fileId, token);
}

/** A failed protection attempt leaves the previous journal entry in storage.
 * Keep its token so a later confirmed save can clear that stale entry. */
export function officeDraftTokenAfterProtect(current: string, protectedToken: string | null): string {
  return protectedToken ?? current;
}

/** Snapshot bytes are JSON for the engine-neutral model; source bytes are the
 * opened DOCX/XLSX/CSV file. Both are base64 so quota is predictable. */
export function snapshotBase64(model: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(model)));
}

export function parseSnapshot<T>(encoded: string): T {
  return JSON.parse(new TextDecoder().decode(bytesFromBase64(encoded))) as T;
}

/** Replay before editors mount. A stale base is always a free sibling; a
 * failed write stays in a separate kept record for the next boot. */
export async function replayOfficeDrafts(
  store: SyncStore,
  vault: string,
  dir: VaultDir,
  encode: (draft: OfficeDraft) => Promise<Uint8Array> = encodeOfficeDraft,
  sessionIsAbandoned: (vault: string, sessionId: string) => Promise<boolean> = abandonedOfficeSession,
): Promise<{ saved: number; keptAside: string[]; unresolved: number }> {
  const drafts = readOfficeDrafts(store, vault);
  let saved = 0;
  const keptAside: string[] = [];
  let unresolved = 0;
  const draftsPerFile = new Map<string, number>();
  for (const draft of drafts) draftsPerFile.set(draft.fileId, (draftsPerFile.get(draft.fileId) ?? 0) + 1);
  for (const draft of drafts) {
    // A failed liveness probe gives no authority to move even the local
    // journal key into kept storage. Leave the peer's record byte-for-byte.
    let abandoned = false;
    try {
      abandoned = await sessionIsAbandoned(vault, draft.sessionId);
    } catch {
      continue;
    }
    if (!abandoned) continue;
    try {
      assertVaultFilePath(draft.fileId);
      if (bytesRevision(bytesFromBase64(draft.sourceBase64)) !== draft.baseRevision)
        throw new Error("draft source revision does not match its base");
      const next = await encode(draft);
      const current = await dir.readBytes(draft.fileId).catch(() => null);
      if (
        draftsPerFile.get(draft.fileId) === 1 &&
        current &&
        bytesRevision(current) === bytesRevision(next)
      ) {
        clearOfficeDraft(store, vault, draft.fileId, draft.token);
        continue;
      }
      if (draftsPerFile.get(draft.fileId) === 1 && current && bytesRevision(current) === draft.baseRevision) {
        try {
          await folderWriteFileBytes(dir, draft.fileId, bytesToBase64(next), true, draft.baseRevision);
          saved += 1;
          clearOfficeDraft(store, vault, draft.fileId, draft.token);
          continue;
        } catch (error) {
          if (!(error instanceof Error) || !/revision conflict/i.test(error.message)) throw error;
          // Another writer won the save turn. Preserve both below.
        }
      }
      const copy = await freeSiblingPath(dir, draft.fileId, "unsaved copy");
      await dir.writeBytes(copy, next, "0");
      keptAside.push(copy);
      clearOfficeDraft(store, vault, draft.fileId, draft.token);
    } catch {
      unresolved += 1;
      const activeKey = draftKey(vault, draft);
      if (read(store, activeKey)?.token === draft.token) {
        try {
          store.setItem(draftKey(vault, draft, true), JSON.stringify(draft));
          if (read(store, activeKey)?.token === draft.token) store.removeItem(activeKey);
        } catch {
          // The active record still holds this draft if storage refuses.
        }
      }
    }
  }
  return { saved, keptAside, unresolved };
}

async function encodeOfficeDraft(draft: OfficeDraft): Promise<Uint8Array> {
  if (draft.kind === "docx") {
    const { docxEditorCodec } = await import("../documents/codec/docx");
    const source = await docxEditorCodec.decode(draft.sourceBase64, draft.fileId);
    const encoded = await docxEditorCodec.encode(source.source, parseSnapshot(draft.snapshotBase64));
    return bytesFromBase64(encoded);
  }
  if (draft.kind === "csv") {
    const { csvTextFromRows } = await import("../sheets/csv");
    const { csvRowsFromSnapshot } = await import("../sheets/engine/bridge");
    return new TextEncoder().encode(
      csvTextFromRows(csvRowsFromSnapshot(parseSnapshot(draft.snapshotBase64))),
    );
  }
  const { loadXlsx, saveXlsx } = await import("../sheets/codec/xlsx");
  const { applyModelToWorkbook } = await import("../sheets/engine/bridge");
  const original = bytesFromBase64(draft.sourceBase64);
  const wb = await loadXlsx(original.buffer as ArrayBuffer);
  applyModelToWorkbook(
    wb,
    parseSnapshot(draft.snapshotBase64),
    draft.sheetIdMap ? new Map(draft.sheetIdMap) : undefined,
  );
  return saveXlsx(wb);
}
