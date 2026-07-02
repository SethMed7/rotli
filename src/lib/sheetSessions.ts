// Parked DIRTY spreadsheet sessions + the window-hide flush (#4, audit 2026-07).
//
// Unsaved sheet edits must survive the pane lifecycle AND the window lifecycle:
// PaneTree renders only the active tab, so a tab switch unmounts the whole
// SheetEditor — dirty sessions park here per file id (SheetEditor refreshes the
// entry on every edit, clears it on a successful explicit save). That covered
// tab switches; hiding/closing the window still killed the JS Map with every
// edit in it, while the parked UI had taught "your edits are safe". So: the
// moment the window hides (visibilitychange, the same seam persist.ts flushes
// settings on) or unloads (pagehide), every parked session is serialized and
// written through the SAME explicit-save path (bak=true — Rust keeps the
// one-time .bak of the pre-rotli original). And because ⌘Q / tray-Quit can
// fire with the window still up (no hide ever happened — "Stay open" mode
// makes that the common case) while the exceljs serialize is async work that
// can't finish during teardown, the flush is ALSO registered on the quit-flush
// handshake: Rust intercepts both quit paths and holds the exit until this
// flush acks (lib/quitFlush.ts). Explicit Save stays the law WHILE the window
// is up; the hide/quit flush is the data-safety backstop, exactly like a
// note's flush-on-hide.
//
// This module lives in the lazy SheetEditor chunk (exceljs rides only as a
// type), so the listeners exist only once a sheet editor has actually mounted
// — before that there is nothing dirty to flush and the quit ack is instant.

import type { Workbook } from "exceljs";
import { onQuitFlush } from "./quitFlush";
import { type EditSheet, b64FromBytes, b64FromText, csvTextFromRows } from "./sheetEdit";
import { corpusWriteFileBytes } from "./tauri";

/** One parked dirty session: the workbook (xlsx; the save payload) or null
 * (csv — the grid IS the payload), plus the render grids. */
export interface SheetSession {
  wb: Workbook | null;
  grids: EditSheet[];
}

/** Dirty sessions by file wire id — see the module doc. SheetEditor sets a
 * FRESH object on every committed edit (that identity is what lets the flush
 * detect an edit that landed while its write was in flight). */
export const dirtySessions = new Map<string, SheetSession>();

/** Serialize a session to the base64 payload corpus_write_file_bytes takes —
 * exactly what SheetEditor.save() would have written. */
export async function serializeSession(session: SheetSession): Promise<string> {
  if (session.wb) {
    const buffer = await session.wb.xlsx.writeBuffer();
    return b64FromBytes(new Uint8Array(buffer));
  }
  // csv: a single grid, values only (styles can't exist in a csv session)
  const rows = (session.grids[0]?.rows ?? []).map((row) => row.map((cell) => cell.v));
  return b64FromText(csvTextFromRows(rows));
}

let flushing = false;

/** Write every parked dirty session to disk (bak=true, the explicit-save
 * shape). A session is cleared only when no new edit re-parked it while the
 * write was in flight; a failed write keeps it parked for the next flush.
 * `write` is injectable for tests only. */
export async function flushDirtySheets(write = corpusWriteFileBytes): Promise<void> {
  if (flushing || dirtySessions.size === 0) return;
  flushing = true;
  try {
    for (const [fileId, session] of [...dirtySessions]) {
      try {
        const base64 = await serializeSession(session);
        await write(fileId, base64, true);
        if (dirtySessions.get(fileId) === session) dirtySessions.delete(fileId);
      } catch {
        // read-only root, band refusal, disk error — stays parked; the mounted
        // editor's own Save surfaces the reason
      }
    }
  } finally {
    flushing = false;
  }
}

// the window-hide seam (mirrors persist.ts's settings flush): hidden ⇒ flush.
// Guarded so the module stays importable under bun tests (no document there).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flushDirtySheets();
  });
  window.addEventListener("pagehide", () => void flushDirtySheets());
}
// the QUIT seam: ⌘Q / tray-Quit with the window still up never fired a hide —
// Rust holds the exit until this flush settles (see the module doc).
onQuitFlush(() => flushDirtySheets());
