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
}
export type OfficeDraftInput = Omit<OfficeDraft, "token">;
type SyncStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// localStorage is commonly about 5 MiB for the whole origin. ASCII base64 may
// count as two UTF-16 bytes per character; at most 2.4 MiB leaves over half
// for notes, pending operations, settings, and browser overhead.
export const OFFICE_DRAFT_ENTRY_MAX_CHARS = 1_000_000;
export const OFFICE_DRAFT_TOTAL_MAX_CHARS = 1_200_000;
export const OFFICE_DRAFT_WARNING =
  "This change isn't protected until it saves. The browser's draft storage is full or this file is too large.";
const PREFIX = "rotli-office-unsaved:";
let serial = 0;

export const officeDraftKey = (vault: string): string => `${PREFIX}${vault}`;
const keptKey = (vault: string): string => `${officeDraftKey(vault)}:kept`;

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
    typeof draft.token === "string"
  );
}

function read(store: SyncStore, key: string): OfficeDraft[] {
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

export function readOfficeDrafts(store: SyncStore, vault: string): OfficeDraft[] {
  return [...read(store, keptKey(vault)), ...read(store, officeDraftKey(vault))];
}

/** Returns false when storage is blocked or the latest edit exceeds the
 * budget. The older protected edit is left intact, and the editor warns. */
export function writeOfficeDraft(
  store: SyncStore,
  vault: string,
  input: OfficeDraftInput,
): { protected: boolean; token: string } {
  const token = `${Date.now()}:${++serial}`;
  try {
    assertVaultFilePath(input.fileId);
    const draft = { ...input, token };
    const encoded = JSON.stringify(draft);
    if (encoded.length > OFFICE_DRAFT_ENTRY_MAX_CHARS) return { protected: false, token };
    const key = officeDraftKey(vault);
    const next = [...read(store, key).filter((item) => item.fileId !== input.fileId), draft];
    const payload = JSON.stringify(next);
    if (payload.length + (store.getItem(keptKey(vault))?.length ?? 0) > OFFICE_DRAFT_TOTAL_MAX_CHARS)
      return { protected: false, token };
    store.setItem(key, payload);
    return { protected: true, token };
  } catch {
    return { protected: false, token };
  }
}

/** A completed save may clear only the exact draft it started with. */
export function clearOfficeDraft(store: SyncStore, vault: string, fileId: string, token: string): void {
  for (const key of [officeDraftKey(vault), keptKey(vault)]) {
    const current = read(store, key);
    const next = current.filter((draft) => draft.fileId !== fileId || draft.token !== token);
    if (next.length === current.length) continue;
    if (next.length) store.setItem(key, JSON.stringify(next));
    else store.removeItem(key);
  }
}

export function confirmWebOfficeSave(fileId: string, token: string): void {
  if (PLATFORM !== "web" || !token) return;
  const vault = webVaultKey();
  if (vault) clearOfficeDraft(window.localStorage, vault, fileId, token);
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
): Promise<{ saved: number; keptAside: string[]; unresolved: number }> {
  const drafts = readOfficeDrafts(store, vault);
  let saved = 0;
  const keptAside: string[] = [];
  const unresolved: OfficeDraft[] = [];
  for (const draft of drafts) {
    try {
      assertVaultFilePath(draft.fileId);
      if (bytesRevision(bytesFromBase64(draft.sourceBase64)) !== draft.baseRevision)
        throw new Error("draft source revision does not match its base");
      const next = await encode(draft);
      const current = await dir.readBytes(draft.fileId).catch(() => null);
      if (current && bytesRevision(current) === bytesRevision(next)) continue;
      if (current && bytesRevision(current) === draft.baseRevision) {
        try {
          await folderWriteFileBytes(dir, draft.fileId, bytesToBase64(next), true, draft.baseRevision);
          saved += 1;
          continue;
        } catch (error) {
          if (!(error instanceof Error) || !/revision conflict/i.test(error.message)) throw error;
          // Another writer won the save turn. Preserve both below.
        }
      }
      const copy = await freeSiblingPath(dir, draft.fileId, "unsaved copy");
      await dir.writeBytes(copy, next, "0");
      keptAside.push(copy);
    } catch {
      unresolved.push(draft);
    }
  }
  // Kept first, then clear the unload record. A storage refusal retains the
  // old record; replay may retry but never loses the unsaved payload.
  if (unresolved.length) store.setItem(keptKey(vault), JSON.stringify(unresolved));
  else store.removeItem(keptKey(vault));
  store.removeItem(officeDraftKey(vault));
  return { saved, keptAside, unresolved: unresolved.length };
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
