// Thin React shell for editable spreadsheets — bar, themed/raw toggle, ⌘S.
// Talks only to sheets/engine + sheets/session + sheets/codec; never @univerjs.

import { useEffect, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { corpusFileBytes, corpusFileStat, corpusFileText } from "../lib/tauri";
import { fileName } from "../lib/fileKind";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { parseCsvExact } from "./csv";
import { bytesFromB64, fillFromCsvRows, loadXlsx } from "./codec/xlsx";
import {
  type SheetHandle,
  type SheetModel,
  type SheetThemeMode,
  buildSheetIdMap,
  mountSheet,
  workbookToModel,
} from "./engine";
import { SHEET_EDIT_MAX_BYTES } from "./kinds";
import {
  deleteParked,
  getParked,
  registerLiveDirty,
  setParked,
  unregisterLiveDirty,
  writeSheetModel,
  type SheetFileMode,
} from "./session";

/** Session-sticky themed/raw per file (tab switches unmount the editor). */
const themeModeMemo = new Map<string, SheetThemeMode>();

function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme ?? "light";
  return t === "dark" || t === "charcoal" || t === "glass-dark";
}

export default function SheetEditor({
  fileId,
  paneId,
  mode,
}: {
  fileId: string;
  paneId: string;
  mode: SheetFileMode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [themeMode, setThemeMode] = useState<SheetThemeMode>(
    () => themeModeMemo.get(fileId) ?? "themed",
  );

  const wbRef = useRef<ExcelJS.Workbook | null>(null);
  const handleRef = useRef<SheetHandle | null>(null);
  const idMapRef = useRef<Map<string, number>>(new Map());
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const diskLenRef = useRef(0);
  const dirtyGen = useRef(0);
  const armedRef = useRef(false);

  useEffect(() => {
    themeModeMemo.set(fileId, themeMode);
    handleRef.current?.setThemeMode(themeMode);
  }, [fileId, themeMode]);

  // rotli dark follows data-theme — only in themed mode
  useEffect(() => {
    const sync = () => handleRef.current?.setDarkMode(isDarkTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let disposeEngine: (() => void) | null = null;
    armedRef.current = false;
    setReady(false);
    setErr(null);

    void (async () => {
      try {
        let park = getParked(fileId);
        if (park) {
          const stat = await corpusFileStat(fileId).catch(() => null);
          const stale = !stat || stat.len !== park.diskLen;
          if (stale || park.mode !== mode) {
            deleteParked(fileId);
            park = undefined;
            if (!disposed && stale)
              setNote("the file changed on disk — unsaved edits from the earlier session were set aside");
          }
        }

        let wb: ExcelJS.Workbook;
        let model: SheetModel;
        if (park) {
          wb = park.wb;
          model = park.model;
          idMapRef.current = park.idMap;
          diskLenRef.current = park.diskLen;
          dirtyGen.current = Math.max(1, dirtyGen.current);
          setDirty(true);
        } else if (mode === "csv") {
          const csv = await corpusFileText(fileId, SHEET_EDIT_MAX_BYTES + 1);
          if (new TextEncoder().encode(csv).length > SHEET_EDIT_MAX_BYTES) {
            throw new Error("this file is too large to edit in rotli — opening read-only is fine");
          }
          diskLenRef.current = new TextEncoder().encode(csv).length;
          const rows = parseCsvExact(csv);
          wb = fillFromCsvRows(
            new ExcelJS.Workbook(),
            fileName(fileId).replace(/\.csv$/i, "") || "Sheet1",
            rows,
          );
          model = workbookToModel(wb, fileId);
          idMapRef.current = buildSheetIdMap(wb, model);
        } else {
          const b64 = await corpusFileBytes(fileId);
          const bytes = bytesFromB64(b64);
          diskLenRef.current = bytes.length;
          wb = await loadXlsx(bytes.buffer as ArrayBuffer);
          model = workbookToModel(wb, fileId);
          idMapRef.current = buildSheetIdMap(wb, model);
        }
        if (disposed) return;
        wbRef.current = wb;

        const handle = mountSheet(host, {
          model,
          darkMode: isDarkTheme(),
          themeMode: themeModeMemo.get(fileId) ?? "themed",
        });
        handleRef.current = handle;

        const sub = handle.onDirty(() => {
          if (!armedRef.current) return;
          dirtyGen.current += 1;
          setDirty(true);
        });
        armedRef.current = true;

        disposeEngine = () => {
          if (sub && typeof sub === "object" && typeof sub.dispose === "function") sub.dispose();
          handle.dispose();
        };
        setReady(true);
      } catch (e) {
        if (!disposed) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      unregisterLiveDirty(fileId);
      try {
        const wb = wbRef.current;
        const handle = handleRef.current;
        if (wb && handle && dirtyGen.current > 0) {
          setParked(fileId, {
            wb,
            model: handle.save(),
            idMap: idMapRef.current,
            diskLen: diskLenRef.current,
            mode: modeRef.current,
          });
        }
      } catch {
        /* park must never block unmount */
      }
      disposeEngine?.();
      handleRef.current = null;
      wbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, mode]);

  useEffect(() => {
    const wb = wbRef.current;
    const handle = handleRef.current;
    if (!dirty || !wb || !handle) {
      unregisterLiveDirty(fileId);
      return;
    }
    registerLiveDirty({
      fileId,
      mode: modeRef.current,
      wb,
      saveModel: () => handle.save(),
      idMap: idMapRef.current,
      diskLen: diskLenRef.current,
      dirtyGen: () => dirtyGen.current,
      onFlushed: (gen) => {
        if (dirtyGen.current === gen) {
          dirtyGen.current = 0;
          setDirty(false);
          deleteParked(fileId);
          unregisterLiveDirty(fileId);
        }
      },
    });
    return () => unregisterLiveDirty(fileId);
  }, [dirty, fileId, ready]);

  const save = async () => {
    const wb = wbRef.current;
    const handle = handleRef.current;
    if (!wb || !handle || saving) return;
    if (!dirty && dirtyGen.current === 0) return;
    const gen = dirtyGen.current;
    setSaving(true);
    setErr(null);
    try {
      const model = handle.save();
      const len = await writeSheetModel(fileId, modeRef.current, wb, model, idMapRef.current);
      diskLenRef.current = len;
      if (dirtyGen.current === gen) {
        dirtyGen.current = 0;
        setDirty(false);
        deleteParked(fileId);
        unregisterLiveDirty(fileId);
      }
      void invalidateNotes();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "s") return;
      if (usePanesStore.getState().focusedPaneId !== paneId) return;
      e.preventDefault();
      e.stopPropagation();
      void saveRef.current();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [paneId]);

  const toggleThemeMode = () => {
    setThemeMode((m) => (m === "themed" ? "raw" : "themed"));
  };

  return (
    <div className={`sheet-editor${themeMode === "raw" ? " sheet-raw" : ""}`}>
      <div className="sheet-editor-bar" role="note">
        {mode === "csv" && (
          <span className="sheet-editor-hint">csv · values only — styles don't survive Save</span>
        )}
        <button
          type="button"
          className={themeMode === "raw" ? "sheet-view-toggle on" : "sheet-view-toggle"}
          title={
            themeMode === "raw"
              ? "Show rotli-themed chrome"
              : "Show the sheet on white paper, like Excel"
          }
          onClick={toggleThemeMode}
        >
          {themeMode === "raw" ? "Themed" : "Raw"}
        </button>
        <span className="sheet-editor-space" />
        {err && <span className="sheet-save-err">⚠ {err}</span>}
        {!err && note && <span className="sheet-save-err">{note}</span>}
        {dirty && !saving && <span className="sheet-dirty" title="Unsaved changes" />}
        <button
          type="button"
          className="sheet-save"
          disabled={saving || !ready}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : dirty ? "Save ⌘S" : "Saved"}
        </button>
      </div>
      {!err && !ready && <p className="file-loading">Loading…</p>}
      <div ref={hostRef} className="sheet-editor-host" />
    </div>
  );
}
