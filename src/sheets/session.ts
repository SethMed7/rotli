// Parked dirty sheet sessions + hide/quit flush (#4). Engine-agnostic — only
// knows SheetModel + exceljs codec; never imports @univerjs/*.

import type { Workbook } from "./codec/xlsx";
import { onQuitFlush } from "../lib/quitFlush";
import { corpusWriteFileBytes } from "../lib/tauri";
import { csvTextFromRows } from "./csv";
import { b64FromBytes, b64FromText, saveXlsx } from "./codec/xlsx";
import { type SheetModel, applyModelToWorkbook, csvRowsFromSnapshot } from "./engine";

export type SheetFileMode = "xlsx" | "csv";

interface ParkedSheet {
  wb: Workbook;
  model: SheetModel;
  idMap: Map<string, number>;
  diskLen: number;
  mode: SheetFileMode;
}

interface LiveDirty {
  fileId: string;
  mode: SheetFileMode;
  wb: Workbook;
  saveModel: () => SheetModel;
  idMap: Map<string, number>;
  diskLen: number;
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
): Promise<number> {
  if (mode === "csv") {
    const text = csvTextFromRows(csvRowsFromSnapshot(model));
    const bytes = new TextEncoder().encode(text);
    await corpusWriteFileBytes(fileId, b64FromText(text), true);
    return bytes.length;
  }
  applyModelToWorkbook(wb, model, idMap);
  const bytes = await saveXlsx(wb);
  await corpusWriteFileBytes(fileId, b64FromBytes(bytes), true);
  return bytes.length;
}

let flushing = false;

/** Write every parked + live-dirty session. Exported for tests. */
export async function flushDirtySheets(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (const [fileId, live] of [...liveDirty]) {
      if (live.dirtyGen() === 0) continue;
      try {
        parked.set(fileId, {
          wb: live.wb,
          model: live.saveModel(),
          idMap: live.idMap,
          diskLen: live.diskLen,
          mode: live.mode,
        });
      } catch {
        /* snapshot failed — retry next flush */
      }
    }
    for (const [fileId, session] of [...parked]) {
      try {
        const genBefore = liveDirty.get(fileId)?.dirtyGen() ?? 0;
        const len = await writeSheetModel(fileId, session.mode, session.wb, session.model, session.idMap);
        const still = parked.get(fileId);
        if (still === session) parked.delete(fileId);
        const live = liveDirty.get(fileId);
        if (live && live.dirtyGen() === genBefore) {
          live.diskLen = len;
          live.onFlushed(genBefore);
        }
      } catch {
        /* stays parked */
      }
    }
  } finally {
    flushing = false;
  }
}

export interface ParkedSession {
  wb: Workbook;
  model: SheetModel;
  idMap: Map<string, number>;
  diskLen: number;
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
    if (document.visibilityState === "hidden") void flushDirtySheets();
  });
  window.addEventListener("pagehide", () => {
    void flushDirtySheets();
  });
}
onQuitFlush(() => flushDirtySheets());
