// Thin React shell for editable spreadsheets — bar chrome, themed/raw toggle, ⌘S.
// Talks only to sheets/engine + sheets/session + sheets/codec; never @univerjs.

import { type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { corpusFileBytes, corpusFileStat, corpusFileText } from "../lib/tauri";
import { fileName } from "../lib/fileKind";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { parseCsvExact } from "./csv";
import { type Workbook, bytesFromB64, fillFromCsvRows, loadXlsx, newWorkbook } from "./codec/xlsx";
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

function currentAppTheme(): string {
  return document.documentElement.dataset.theme ?? "light";
}

function isDarkTheme(theme = currentAppTheme()): boolean {
  const t = theme;
  return t === "dark" || t === "charcoal";
}

export default function SheetEditor({
  fileId,
  paneId,
  mode,
  chromeSlotRef,
}: {
  fileId: string;
  paneId: string;
  mode: SheetFileMode;
  /** Mount Raw / Save next to "Open externally" in the file header. */
  chromeSlotRef?: RefObject<HTMLElement | null>;
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
  const [appTheme, setAppTheme] = useState(currentAppTheme);
  const [chromeEl, setChromeEl] = useState<HTMLElement | null>(null);

  const wbRef = useRef<Workbook | null>(null);
  const handleRef = useRef<SheetHandle | null>(null);
  const idMapRef = useRef<Map<string, number>>(new Map());
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const diskLenRef = useRef(0);
  const dirtyGen = useRef(0);
  const armedRef = useRef(false);

  useEffect(() => {
    setChromeEl(chromeSlotRef?.current ?? null);
  }, [chromeSlotRef]);

  useEffect(() => {
    themeModeMemo.set(fileId, themeMode);
  }, [fileId, themeMode]);

  // Univer's palette is fixed when createUniver runs. Track the concrete app
  // theme so the mount effect below can rebuild from the preserved workbook
  // snapshot when warm/paper/charcoal changes.
  useEffect(() => {
    const sync = () => setAppTheme(currentAppTheme());
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

        let wb: Workbook;
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
            newWorkbook(),
            fileName(fileId).replace(/\.csv$/i, "") || "Sheet1",
            rows,
          );
          model = workbookToModel(wb, fileId);
          idMapRef.current = buildSheetIdMap(wb, model);
        } else {
          const b64 = await corpusFileBytes(fileId, SHEET_EDIT_MAX_BYTES + 1);
          const bytes = bytesFromB64(b64);
          if (bytes.length > SHEET_EDIT_MAX_BYTES) {
            throw new Error("this file is too large to edit in rotli — opening read-only is fine");
          }
          diskLenRef.current = bytes.length;
          wb = await loadXlsx(bytes.buffer as ArrayBuffer);
          model = workbookToModel(wb, fileId);
          idMapRef.current = buildSheetIdMap(wb, model);
        }
        if (disposed) return;
        wbRef.current = wb;

        const handle = mountSheet(host, {
          model,
          darkMode: isDarkTheme(appTheme),
          themeMode,
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
  }, [fileId, mode, themeMode, appTheme]);

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

  const chrome = (
    <div className="sheet-chrome-actions">
      {mode === "csv" && (
        <span className="sheet-editor-hint" title="csv · values only — styles don't survive Save">
          csv · values only
        </span>
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
  );

  return (
    <div className={`sheet-editor${themeMode === "raw" ? " sheet-raw" : ""}`}>
      {chromeEl ? createPortal(chrome, chromeEl) : <div className="sheet-editor-bar">{chrome}</div>}
      {!err && !ready && <p className="file-loading">Loading…</p>}
      <div ref={hostRef} className="sheet-editor-host" />
    </div>
  );
}
