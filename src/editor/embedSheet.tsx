// Compact Univer host for ```sheet fences — the corpus file stays truth.
// The audit-2026-07-30 loss fixes (correctness #2), mirroring embedBoard +
// SheetEditor: while the sheet's own file TAB is open anywhere the embed goes
// VIEW-ONLY (two live savers on one file silently last-writer-wins each
// other); dirty state registers with the sheets/session quit-flush lane so ⌘Q
// inside the 500ms debounce can't drop edits (and unmount PARKS them for the
// next surface); save failures surface inline instead of .catch(()=>{}).

import { useEffect, useRef, useState } from "react";

import { extOf, fileName } from "../lib/fileKind";
import { corpusFileBytes, corpusFileStat, corpusFileText } from "../lib/tauri";
import { type Workbook, bytesFromB64, fillFromCsvRows, loadXlsx, newWorkbook } from "../sheets/codec/xlsx";
import { parseCsvExact } from "../sheets/csv";
import {
  type SheetHandle,
  type SheetModel,
  buildSheetIdMap,
  mountSheet,
  workbookToModel,
} from "../sheets/engine";
import { SHEET_EDIT_MAX_BYTES } from "../sheets/kinds";
import {
  deleteParked,
  getParked,
  registerLiveDirty,
  setParked,
  unregisterLiveDirty,
  writeSheetModel,
  type SheetFileMode,
} from "../sheets/session";
import { fileTabOpen, usePanesStore } from "../state/panes";

function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme ?? "light";
  return t === "dark" || t === "charcoal";
}

function modeOf(fileId: string): SheetFileMode {
  return extOf(fileId) === "csv" ? "csv" : "xlsx";
}

export function SheetEmbed({ fileId }: { fileId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [readOnly, setReadOnly] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const handleRef = useRef<SheetHandle | null>(null);
  const wbRef = useRef<Workbook | null>(null);
  const idMapRef = useRef<Map<string, number>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyGen = useRef(0);
  const diskLenRef = useRef(0);
  const revisionRef = useRef("");
  const armedRef = useRef(false);
  // the registered quit-flush entry — flushDirtySheets writes its diskLen back
  const entryRef = useRef<{ diskLen: number; revision: string } | null>(null);

  // the sheet's own tab open somewhere? that surface owns the pen
  const tabOpen = usePanesStore((s) => fileTabOpen(s.root, fileId));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const mode = modeOf(fileId);
    setStatus("loading");
    setSaveErr(null);

    const load = async () => {
      try {
        const stat = await corpusFileStat(fileId);
        if (!stat || stat.len > SHEET_EDIT_MAX_BYTES) {
          if (!cancelled) setStatus("error");
          return;
        }
        const writable = stat.writable && !tabOpen;
        if (!cancelled) setReadOnly(!writable);

        // A parked session (this embed or a tab dismissed mid-debounce) is
        // NEWER than disk — resume it instead of showing stale rows and
        // double-truthing the pending flush. Stale parks (the file changed on
        // disk underneath) are dropped, exactly like SheetEditor.
        let park = writable ? getParked(fileId) : undefined;
        if (park && (park.mode !== mode || stat.revision !== park.revision)) {
          deleteParked(fileId);
          park = undefined;
        }

        let wb: Workbook;
        let model: SheetModel;
        if (park) {
          wb = park.wb;
          model = park.model;
          idMapRef.current = park.idMap;
          diskLenRef.current = park.diskLen;
          revisionRef.current = park.revision;
          dirtyGen.current = Math.max(1, dirtyGen.current);
        } else if (mode === "csv") {
          revisionRef.current = stat.revision;
          const csv = await corpusFileText(fileId, SHEET_EDIT_MAX_BYTES + 1);
          wb = fillFromCsvRows(
            newWorkbook(),
            fileName(fileId).replace(/\.csv$/i, "") || "Sheet1",
            parseCsvExact(csv),
          );
          model = workbookToModel(wb, fileId);
          idMapRef.current = buildSheetIdMap(wb, model);
          diskLenRef.current = stat.len;
        } else {
          revisionRef.current = stat.revision;
          const b64 = await corpusFileBytes(fileId);
          const bytes = bytesFromB64(b64);
          wb = await loadXlsx(bytes.buffer as ArrayBuffer);
          model = workbookToModel(wb, fileId);
          idMapRef.current = buildSheetIdMap(wb, model);
          diskLenRef.current = stat.len;
        }
        if (cancelled) return;
        wbRef.current = wb;
        const handle = mountSheet(host, {
          model,
          darkMode: isDarkTheme(),
          themeMode: "themed",
          readOnly: !writable,
        });
        host.inert = !writable;
        handleRef.current = handle;

        if (writable) {
          const queueWrite = () => {
            const gen = dirtyGen.current;
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
              if (gen !== dirtyGen.current) return;
              const wbLive = wbRef.current;
              if (!wbLive) return;
              let snap: SheetModel;
              try {
                snap = handle.save();
              } catch {
                return; // snapshot failed — the flush lane retries
              }
              writeSheetModel(fileId, mode, wbLive, snap, idMapRef.current, revisionRef.current)
                .then((saved) => {
                  if (gen === dirtyGen.current) {
                    dirtyGen.current = 0;
                    diskLenRef.current = saved.len;
                    revisionRef.current = saved.revision;
                    if (entryRef.current) {
                      entryRef.current.diskLen = saved.len;
                      entryRef.current.revision = saved.revision;
                    }
                    deleteParked(fileId);
                  }
                  setSaveErr(null);
                })
                .catch((e: unknown) => {
                  // dirtyGen stays > 0: the quit-flush lane and the next edit
                  // both retry — but SAY it, silence here is data loss
                  setSaveErr(e instanceof Error ? e.message : String(e));
                });
            }, 500);
          };

          handle.onDirty(() => {
            if (!armedRef.current) return;
            dirtyGen.current += 1;
            queueWrite();
          });
          armedRef.current = true;

          // the quit-flush lane: ⌘Q (or window-hide) inside the debounce
          // window writes through flushDirtySheets instead of dying with the
          // timer — the gap SheetEditor always covered and the embed didn't
          const entry = {
            fileId,
            mode,
            wb,
            saveModel: () => handle.save(),
            idMap: idMapRef.current,
            diskLen: diskLenRef.current,
            revision: revisionRef.current,
            dirtyGen: () => dirtyGen.current,
            onFlushed: (gen: number) => {
              if (dirtyGen.current === gen) {
                dirtyGen.current = 0;
                diskLenRef.current = entry.diskLen;
                revisionRef.current = entry.revision;
                deleteParked(fileId);
              }
            },
          };
          entryRef.current = entry;
          registerLiveDirty(entry);

          // resumed parked edits have no keystroke coming — write them soon
          if (dirtyGen.current > 0) queueWrite();
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void load();

    const syncDark = () => handleRef.current?.setDarkMode(isDarkTheme());
    const mo = new MutationObserver(syncDark);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      cancelled = true;
      mo.disconnect();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      unregisterLiveDirty(fileId);
      entryRef.current = null;
      // park un-flushed edits so nothing dies with the widget — scroll-away
      // remounts resume them; flushDirtySheets writes them on hide/quit
      try {
        const wb = wbRef.current;
        const handle = handleRef.current;
        if (wb && handle && dirtyGen.current > 0) {
          setParked(fileId, {
            wb,
            model: handle.save(),
            idMap: idMapRef.current,
            diskLen: diskLenRef.current,
            revision: revisionRef.current,
            mode,
          });
        }
      } catch {
        /* park must never block unmount */
      }
      handleRef.current?.dispose();
      handleRef.current = null;
      wbRef.current = null;
      armedRef.current = false;
    };
  }, [fileId, tabOpen]);

  return (
    <div className={readOnly ? "rotli-embed-sheet-wrap is-readonly" : "rotli-embed-sheet-wrap"}>
      <div ref={hostRef} className="rotli-embed-sheet-inner" />
      {status === "loading" && <div className="rotli-embed-placeholder">Loading sheet…</div>}
      {status === "error" && <div className="rotli-embed-placeholder">Sheet unavailable</div>}
      {status === "ready" && tabOpen && (
        <div className="rotli-embed-viewonly">Open in its tab — the embed is view-only meanwhile.</div>
      )}
      {status === "ready" && readOnly && !tabOpen && <span className="rotli-embed-readonly">Read-only</span>}
      {saveErr && (
        <div className="rotli-embed-saveerr" role="alert">
          ⚠ This sheet isn’t saving — {saveErr}
        </div>
      )}
    </div>
  );
}
