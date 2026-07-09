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
import { corpusFileBytes } from "../lib/tauri";
import { bytesFromB64 } from "../lib/sheetEdit";
// the P1 bridge: the FULL modeled projection (values, formulas, styles, borders,
// merges, sizes, freeze, numFmt) — the spike shows the real file faithfully
import { workbookToUniverData } from "../lib/univerBridge";

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
        const data = { ...workbookToUniverData(wb, fileId), locale: LocaleType.EN_US };
        univerAPI.createWorkbook(data as unknown as Parameters<typeof univerAPI.createWorkbook>[0]);
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
