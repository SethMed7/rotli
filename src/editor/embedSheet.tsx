// Compact Univer host for ```sheet fences — the corpus file stays truth.

import ExcelJS from "exceljs";
import { useEffect, useRef, useState } from "react";
import { corpusFileBytes, corpusFileStat, corpusFileText } from "../lib/tauri";
import { fileName } from "../lib/fileKind";
import { parseCsvExact } from "../sheets/csv";
import { bytesFromB64, fillFromCsvRows, loadXlsx } from "../sheets/codec/xlsx";
import { type SheetHandle, buildSheetIdMap, mountSheet, workbookToModel } from "../sheets/engine";
import { SHEET_EDIT_MAX_BYTES } from "../sheets/kinds";
import { writeSheetModel, type SheetFileMode } from "../sheets/session";

function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme ?? "light";
  return t === "dark" || t === "charcoal";
}

function modeOf(fileId: string): SheetFileMode {
  const ext = fileId.toLowerCase().split(".").pop() ?? "";
  return ext === "csv" ? "csv" : "xlsx";
}

export function SheetEmbed({ fileId }: { fileId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [readOnly, setReadOnly] = useState(false);
  const handleRef = useRef<SheetHandle | null>(null);
  const wbRef = useRef<ExcelJS.Workbook | null>(null);
  const idMapRef = useRef<Map<string, number>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyGen = useRef(0);
  const armedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const mode = modeOf(fileId);

    const load = async () => {
      try {
        const stat = await corpusFileStat(fileId);
        if (!stat || stat.len > SHEET_EDIT_MAX_BYTES) {
          if (!cancelled) setStatus("error");
          return;
        }
        const writable = stat.writable;
        if (!cancelled) setReadOnly(!writable);
        let wb: ExcelJS.Workbook;
        let model: ReturnType<typeof workbookToModel>;
        if (mode === "csv") {
          const csv = await corpusFileText(fileId, SHEET_EDIT_MAX_BYTES + 1);
          wb = fillFromCsvRows(
            new ExcelJS.Workbook(),
            fileName(fileId).replace(/\.csv$/i, "") || "Sheet1",
            parseCsvExact(csv),
          );
          model = workbookToModel(wb, fileId);
        } else {
          const b64 = await corpusFileBytes(fileId);
          const bytes = bytesFromB64(b64);
          wb = await loadXlsx(bytes.buffer as ArrayBuffer);
          model = workbookToModel(wb, fileId);
        }
        if (cancelled) return;
        wbRef.current = wb;
        idMapRef.current = buildSheetIdMap(wb, model);
        const handle = mountSheet(host, {
          model,
          darkMode: isDarkTheme(),
          themeMode: "themed",
          readOnly: !writable,
        });
        host.inert = !writable;
        handleRef.current = handle;
        if (writable) {
          handle.onDirty(() => {
            if (!armedRef.current) return;
            dirtyGen.current += 1;
            const gen = dirtyGen.current;
            if (saveTimer.current) clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => {
              if (gen !== dirtyGen.current) return;
              const snap = handle.save();
              const wbLive = wbRef.current;
              if (!wbLive) return;
              void writeSheetModel(fileId, mode, wbLive, snap, idMapRef.current).catch(() => {});
            }, 500);
          });
          armedRef.current = true;
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
      handleRef.current?.dispose();
      handleRef.current = null;
      wbRef.current = null;
      armedRef.current = false;
    };
  }, [fileId]);

  if (status === "loading") {
    return <div className="rotli-embed-placeholder">Loading sheet…</div>;
  }
  if (status === "error") {
    return <div className="rotli-embed-placeholder">Sheet unavailable</div>;
  }

  return (
    <div className={readOnly ? "rotli-embed-sheet-wrap is-readonly" : "rotli-embed-sheet-wrap"}>
      <div ref={hostRef} className="rotli-embed-sheet-inner" />
      {readOnly && <span className="rotli-embed-readonly">Read-only</span>}
    </div>
  );
}
