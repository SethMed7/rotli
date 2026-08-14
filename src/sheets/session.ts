// Parked dirty sheet sessions + hide/quit flush (#4). Engine-agnostic — only
// knows SheetModel + exceljs codec; never imports @univerjs/*.

import { onQuitFlush } from "../lib/quitFlush";
import { corpusWriteFileBytes } from "../lib/tauri";
import type { Workbook } from "./codec/xlsx";
import { b64FromBytes, b64FromText, saveXlsx } from "./codec/xlsx";
import { csvTextFromRows } from "./csv";
import { type SheetModel, applyModelToWorkbook, csvRowsFromSnapshot } from "./engine";

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

export function registerLiveDirty(entry: LiveDirty): void {
  liveDirty.set(entry.fileId, entry);
}

export function unregisterLiveDirty(fileId: string): void {
  liveDirty.delete(fileId);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDirtySheets().catch(() => {});
  });
  window.addEventListener("pagehide", () => {
    void flushDirtySheets().catch(() => {});
  });
}
onQuitFlush(() => flushDirtySheets());
