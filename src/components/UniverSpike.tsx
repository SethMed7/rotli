// UNIVER SPIKE (Phase 0 of the engine adoption — decision 2026-07-09): mount
// Univer's FREE Apache-2.0 sheets preset in a rotli pane, feed it the REAL xlsx
// through a minimal exceljs → IWorkbookData value projection, and answer the
// go/no-go questions: WKWebView canvas perf, clipboard, theming/dark mode, and
// the lazy-chunk cost. EDITS DON'T SAVE — there is deliberately no write path
// yet (the faithful snapshot → exceljs bridge is Phase 1), so the spike can
// never touch the file. rotli's disk codec stays exceljs; we never load any
// @univerjs-pro/* package (their xlsx exchange is Pro + server-backed — bypassed
// by owning the codec).

import { useEffect, useRef, useState } from "react";
import { LocaleType, createUniver, merge } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import ExcelJS from "exceljs";
import type { CellValue, Workbook } from "exceljs";
import { corpusFileBytes } from "../lib/tauri";
import { bytesFromB64 } from "../lib/sheetEdit";

/** One Univer cell from an exceljs value — values only (styles are Phase 1).
 * Formula cells carry BOTH the formula and the cached result, so the engine
 * shows the value and can recalc live. */
function cellOf(v: CellValue): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return { v };
  if (typeof v === "string") return v === "" ? null : { v };
  if (v instanceof Date) return { v: v.toISOString().slice(0, 10) };
  if (typeof v === "object") {
    if ("richText" in v) return { v: v.richText.map((r) => r.text).join("") };
    if ("formula" in v || "sharedFormula" in v) {
      const f = "formula" in v ? v.formula : undefined;
      const result = "result" in v ? cellOf(v.result as CellValue) : null;
      return { ...(f ? { f: `=${f}` } : {}), ...(result ?? {}) };
    }
    if ("text" in v) return cellOf(v.text as CellValue);
    if ("error" in v) return { v: String(v.error) };
  }
  return { v: String(v) };
}

/** Minimal exceljs → IWorkbookData projection (values + formulas + rough column
 * widths + frozen first rows). The FAITHFUL style/merge/numfmt bridge is Phase 1;
 * this is just enough for the spike to feel like the real file. */
function workbookData(wb: Workbook, name: string): Record<string, unknown> {
  const sheets: Record<string, unknown> = {};
  const sheetOrder: string[] = [];
  wb.worksheets.forEach((ws, i) => {
    const id = `sheet-${i}`;
    sheetOrder.push(id);
    const cellData: Record<number, Record<number, unknown>> = {};
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const out = cellOf(cell.value);
        if (out) (cellData[r - 1] ??= {})[c - 1] = out;
      });
    });
    const columnData: Record<number, { w: number }> = {};
    ws.columns?.forEach((col, c) => {
      if (col?.width) columnData[c] = { w: Math.round(col.width * 8) }; // chars → ~px
    });
    sheets[id] = {
      id,
      name: ws.name,
      cellData,
      columnData,
      rowCount: Math.max(ws.rowCount + 40, 100),
      columnCount: Math.max(ws.columnCount + 8, 26),
      ...(ws.views?.[0]?.state === "frozen"
        ? { freeze: { xSplit: ws.views[0].xSplit ?? 0, ySplit: ws.views[0].ySplit ?? 0, startRow: -1, startColumn: -1 } }
        : {}),
    };
  });
  return { id: `spike-${name}`, name, sheetOrder, sheets, locale: LocaleType.EN_US, styles: {} };
}

/** Is the CURRENT rotli theme a dark one? (data-theme on :root — same signal
 * the CSS color-scheme rule keys off.) */
function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme ?? "light";
  return t === "dark" || t === "charcoal" || t === "glass-dark";
}

export default function UniverSpike({ fileId }: { fileId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        const b64 = await corpusFileBytes(fileId);
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(bytesFromB64(b64).buffer as ArrayBuffer);
        if (disposed) return;
        const { univer, univerAPI } = createUniver({
          locale: LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: merge({}, UniverPresetSheetsCoreEnUS) },
          darkMode: isDarkTheme(),
          presets: [UniverSheetsCorePreset({ container: host })],
        });
        dispose = () => univer.dispose();
        univerAPI.createWorkbook(workbookData(wb, fileId) as Parameters<typeof univerAPI.createWorkbook>[0]);
        setReady(true);
      } catch (e) {
        if (!disposed) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      disposed = true;
      dispose?.();
    };
  }, [fileId]);

  return (
    <div className="univer-spike">
      <div className="univer-spike-note" role="note">
        Univer spike — the full grammar (formulas, fill handle, copy/paste, undo) is live to try;{" "}
        <b>edits don&rsquo;t save yet</b> (the faithful save bridge is the next phase).
      </div>
      {err && <p className="file-err">⚠ {err}</p>}
      {!err && !ready && <p className="file-loading">Loading the engine…</p>}
      <div ref={hostRef} className="univer-spike-host" />
    </div>
  );
}
