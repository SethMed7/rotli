// Parked dirty sheet sessions + hide/quit flush (#4). Engine-agnostic — only
// knows SheetModel + exceljs codec; never imports @univerjs/*.

import { fileNameStem } from "../lib/fileKind";
import { onQuitFlush } from "../lib/quitFlush";
import { corpusCreateManagedFile, corpusWriteFileBytes, rootIdOf } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import type { Workbook } from "./codec/xlsx";
import { b64FromBytes, b64FromText, saveXlsx } from "./codec/xlsx";
import { csvTextFromRows } from "./csv";
import { applyModelToWorkbook, csvRowsFromSnapshot } from "./engine/bridge";
import type { SheetModel } from "./engine/types";

export type SheetFileMode = "xlsx" | "csv";

interface ParkedSheet {
  wb: Workbook;
  model: SheetModel;
  idMap: Map<string, number>;
  diskLen: number;
  revision: string;
  mode: SheetFileMode;
}

interface LiveDirty {
  fileId: string;
  mode: SheetFileMode;
  wb: Workbook;
  saveModel: () => SheetModel;
  idMap: Map<string, number>;
  diskLen: number;
  revision: string;
  dirtyGen: () => number;
  onFlushed: (gen: number) => void;
}

const parked = new Map<string, ParkedSheet>();
const liveDirty = new Map<string, LiveDirty>();
/** Parked edits whose file changed on disk since. Held out of `parked` so the
 * hide/quit flush never retries a write the revision check can only refuse;
 * the editor offers to save them as a copy or discard them. */
const setAside = new Map<string, ParkedSheet[]>();

/** What reopening a sheet does with edits parked from an earlier session: none
 * parked or a different mode opens the file fresh; an unchanged file resumes
 * them; a file that changed on disk is a conflict the person resolves. */
export function parkedResume(
  park: ParkedSheet | undefined,
  diskRevision: string,
  mode: SheetFileMode,
): "fresh" | "resume" | "conflict" {
  if (!park || park.mode !== mode) return "fresh";
  return park.revision === diskRevision ? "resume" : "conflict";
}

/** Serialize one session to disk (bak=true). */
export async function writeSheetModel(
  fileId: string,
  mode: SheetFileMode,
  wb: Workbook,
  model: SheetModel,
  idMap: Map<string, number>,
  expectedRevision: string,
): Promise<{ len: number; revision: string }> {
  if (mode === "csv") {
    const text = csvTextFromRows(csvRowsFromSnapshot(model));
    const bytes = new TextEncoder().encode(text);
    const revision = await corpusWriteFileBytes(fileId, b64FromText(text), true, expectedRevision);
    return { len: bytes.length, revision };
  }
  applyModelToWorkbook(wb, model, idMap);
  const bytes = await saveXlsx(wb);
  const revision = await corpusWriteFileBytes(fileId, b64FromBytes(bytes), true, expectedRevision);
  return { len: bytes.length, revision };
}

let activeFlush: Promise<void> | null = null;

/** Write every parked + live-dirty session. Exported for tests. */
export function flushDirtySheets(): Promise<void> {
  if (activeFlush) return activeFlush;
  activeFlush = (async () => {
    const failures: string[] = [];
    for (const [fileId, live] of [...liveDirty]) {
      if (live.dirtyGen() === 0) continue;
      try {
        parked.set(fileId, {
          wb: live.wb,
          model: live.saveModel(),
          idMap: live.idMap,
          diskLen: live.diskLen,
          revision: live.revision,
          mode: live.mode,
        });
      } catch (error) {
        failures.push(
          `${fileId}: snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const [fileId, session] of [...parked]) {
      try {
        const genBefore = liveDirty.get(fileId)?.dirtyGen() ?? 0;
        const saved = await writeSheetModel(
          fileId,
          session.mode,
          session.wb,
          session.model,
          session.idMap,
          session.revision,
        );
        const still = parked.get(fileId);
        if (still === session) parked.delete(fileId);
        const live = liveDirty.get(fileId);
        if (live && live.dirtyGen() === genBefore) {
          live.diskLen = saved.len;
          live.revision = saved.revision;
          live.onFlushed(genBefore);
        }
      } catch (error) {
        failures.push(`${fileId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) throw new Error(failures.join("; "));
  })().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

export interface ParkedSession {
  wb: Workbook;
  model: SheetModel;
  idMap: Map<string, number>;
  diskLen: number;
  revision: string;
  mode: SheetFileMode;
}

export function getParked(fileId: string): ParkedSession | undefined {
  return parked.get(fileId);
}

export function setParked(fileId: string, session: ParkedSession): void {
  parked.set(fileId, session);
}

export function deleteParked(fileId: string): void {
  parked.delete(fileId);
}

/** Move a stale parked session aside, out of the flush. */
/** Each conflict adds its edits; an earlier unresolved one is never replaced. */
export function setAsideParked(fileId: string): void {
  const session = parked.get(fileId);
  if (!session) return;
  parked.delete(fileId);
  setAside.set(fileId, [...(setAside.get(fileId) ?? []), session]);
}

/** Edits set aside for this file, oldest first (empty when none). */
export function getSetAside(fileId: string): readonly ParkedSession[] {
  return setAside.get(fileId) ?? [];
}

export function deleteSetAside(fileId: string): void {
  setAside.delete(fileId);
}

/** Set-aside edits are always saved as a workbook: the managed lane Rotli may
 * create in takes .xlsx, and a CSV's edits keep their values there. */
export function setAsideCopyName(fileId: string): string {
  return `${fileNameStem(fileId)} (my edits).xlsx`;
}

/** The workbook bytes of a parked session — a CSV's too, since its parked
 * workbook was filled from its rows. Exported for tests. */
export async function setAsideCopyBytes(session: ParkedSession): Promise<Uint8Array> {
  applyModelToWorkbook(session.wb, session.model, session.idMap);
  return saveXlsx(session.wb);
}

/** Save set-aside edits as a new workbook beside Rotli's other sheets, leaving
 * the file that changed on disk untouched. Returns the copy's id. */
export async function saveSetAsideAsCopy(
  fileId: string,
  create: (name: string, base64: string, rootId?: string) => Promise<string> = corpusCreateManagedFile,
): Promise<string> {
  const sessions = setAside.get(fileId) ?? [];
  if (sessions.length === 0) throw new Error("there are no set-aside edits for this file");
  // the default root is addressed by omission, as every other caller does
  const rootId = rootIdOf(fileId);
  let copyId = "";
  // one copy per set-aside session, oldest first; Rust picks a free name for
  // each. A failure keeps that session and every later one set aside.
  while (setAside.get(fileId)?.length) {
    const session = setAside.get(fileId)![0]!;
    const bytes = await setAsideCopyBytes(session);
    copyId = await create(
      setAsideCopyName(fileId),
      b64FromBytes(bytes),
      rootId === "default" ? undefined : rootId,
    );
    if (!copyId) throw new Error("this build can't create files");
    const rest = setAside.get(fileId)!.slice(1);
    if (rest.length) setAside.set(fileId, rest);
    else setAside.delete(fileId);
  }
  return copyId;
}

/** Run a background flush; a failure is reported, never swallowed. */
export async function flushOnHide(
  flush: () => Promise<void>,
  report: (message: string) => void,
): Promise<void> {
  try {
    await flush();
  } catch (error) {
    report(
      `Couldn’t save a spreadsheet in the background — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function registerLiveDirty(entry: LiveDirty): void {
  liveDirty.set(entry.fileId, entry);
}

export function unregisterLiveDirty(fileId: string): void {
  liveDirty.delete(fileId);
}

const reportBackgroundSave = (message: string) => useUiStore.getState().setRowActionError(message);

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushOnHide(flushDirtySheets, reportBackgroundSave);
  });
  window.addEventListener("pagehide", () => {
    void flushOnHide(flushDirtySheets, reportBackgroundSave);
  });
}
onQuitFlush(() => flushDirtySheets());
