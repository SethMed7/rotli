// The EDITABLE spreadsheet surface (.xlsx/.csv) — a hand-rolled grid over the
// exceljs workbook, lazy-loaded from FileSurface so exceljs (~250KB gz) never
// rides the main chunk. The workbook object is the style/structure source of
// truth; the grid state is its render projection, and every edit lands on both.
// Explicit Save only (button or ⌘S) — a binary rewrite must never autosave on
// keystrokes; the one backstop is the window-HIDE flush in sheetSessions.ts,
// which writes parked dirty sessions the moment the window hides/closes so a
// quit can't silently lose them (#4, audit 2026-07). CSV is values-only (a csv
// can't hold styles); the style toolbar offers a convert-to-xlsx sibling
// instead. FileSurface only mounts this when the Rust probe said the file is
// writable + under the caps — a vault/linked-library sheet stays the read-only
// viewer.

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import ExcelJS from "exceljs";
import type { Workbook } from "exceljs";
import {
  corpusFileBytes,
  corpusFileText,
  corpusNewFileBytes,
  corpusWriteFileBytes,
} from "../lib/tauri";
import { parseCsvExact } from "../lib/sheets";
import {
  type CellStyle,
  type EditSheet,
  MAX_EDIT_COLS,
  MAX_EDIT_ROWS,
  SHEET_EDIT_MAX_BYTES,
  argbFromHex,
  b64FromBytes,
  b64FromText,
  bytesFromB64,
  colLabel,
  csvTextFromRows,
  exceedsEditCaps,
  fillWorkbookFromRows,
  gridFromWorkbook,
  hexFromArgb,
  setCellStyle,
  setCellValue,
  setColumnStyle,
} from "../lib/sheetEdit";
import { fileName } from "../lib/fileKind";
// Unsaved edits must survive the pane lifecycle: PaneTree renders only the
// active tab, so a tab switch unmounts this whole editor — unlike notes (the
// shared model.ts buffer) the workbook lived only in component state, and a
// peek at another tab silently discarded every edit. DIRTY sessions park in
// sheetSessions per file id (refreshed on every edit, cleared on a successful
// save); a clean mount always reloads disk truth, so external changes still
// show. sheetSessions also owns the window-hide flush (#4).
import { dirtySessions } from "../lib/sheetSessions";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";

type Sel = { kind: "cell"; r: number; c: number } | { kind: "col"; c: number };

/** Refusal message shared by every "the load can't round-trip" guard. */
const TOO_LARGE = "this file is too large to edit in rotli — opening read-only is fine";

/** The wire folder id holding `fileId` (keeps a "root:" prefix; "" at local root). */
function folderOf(fileId: string): string {
  const slash = fileId.lastIndexOf("/");
  if (slash >= 0) return fileId.slice(0, slash);
  const colon = fileId.indexOf(":");
  return colon > 0 ? fileId.slice(0, colon + 1) : "";
}

export default function SheetEditor({ fileId, mode }: { fileId: string; mode: "xlsx" | "csv" }) {
  const name = fileName(fileId);
  const [grids, setGrids] = useState<EditSheet[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [convertAsk, setConvertAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the workbook IS the save payload (xlsx mode) — never re-rendered from, so a ref
  const wbRef = useRef<Workbook | null>(null);
  // bumped on every edit; save() only clears `dirty` when no edit landed while
  // the write was in flight (an in-flight edit is NOT in the written payload —
  // "Saved" must never show for a workbook that still differs from disk)
  const dirtyGen = useRef(0);
  const markDirty = () => {
    dirtyGen.current += 1;
    setDirty(true);
  };

  useEffect(() => {
    let cancelled = false;
    // a parked DIRTY session (tab switch unmounted us mid-edit) resumes as-is
    const parked = dirtySessions.get(fileId);
    if (parked) {
      wbRef.current = parked.wb;
      setGrids(parked.grids);
      setDirty(true);
      return;
    }
    const fail = (e: unknown) => !cancelled && setErr((e as Error)?.message ?? "couldn't load the file");
    if (mode === "xlsx") {
      corpusFileBytes(fileId)
        .then(async (b64) => {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(bytesFromB64(b64).buffer as ArrayBuffer);
          if (cancelled) return;
          if (exceedsEditCaps(wb)) {
            // a truncated grid must never save a truncated workbook back
            setErr(TOO_LARGE);
            return;
          }
          wbRef.current = wb;
          setGrids(gridFromWorkbook(wb));
        })
        .catch(fail);
    } else {
      // csv: read ONE byte past the edit gate so a too-big file is DETECTED,
      // never silently cut (the Rust default cap is 200 KB — saving that
      // fragment back would destroy everything past it), and parse EXACTLY
      // (raw strings, blank rows kept, no row slicing) so Save can only ever
      // write what was really read.
      corpusFileText(fileId, SHEET_EDIT_MAX_BYTES + 1)
        .then((csv) => {
          if (cancelled) return;
          if (new TextEncoder().encode(csv).length > SHEET_EDIT_MAX_BYTES) {
            setErr(TOO_LARGE);
            return;
          }
          const rows = parseCsvExact(csv);
          // mirror the xlsx exceedsEditCaps guard — same caps, same refusal
          if (rows.length > MAX_EDIT_ROWS || rows.some((r) => r.length > MAX_EDIT_COLS)) {
            setErr(TOO_LARGE);
            return;
          }
          setGrids([
            { name, rows: rows.map((r) => r.map((v) => ({ v, style: null, formula: false }))) },
          ]);
        })
        .catch(fail);
    }
    return () => {
      cancelled = true;
    };
  }, [fileId, mode, name]);

  // park/refresh the dirty session on every committed edit; save() clears it
  useEffect(() => {
    if (dirty && grids) dirtySessions.set(fileId, { wb: wbRef.current, grids });
  }, [dirty, grids, fileId]);

  const grid = grids?.[activeSheet];
  const ws = () => wbRef.current?.worksheets[activeSheet];
  const colCount = grid?.rows.reduce((m, r) => Math.max(m, r.length), 0) ?? 0;

  /** Immutable grid-state update for one cell (the workbook is mutated
   * separately). Pads a SHORT row out to the target cell first — the exact csv
   * parse keeps rows ragged (a blank line is one cell), and the render already
   * shows placeholders there; editing one must land, not vanish. */
  const patchGridCell = (r: number, c: number, fn: (cell: EditSheet["rows"][0][0]) => EditSheet["rows"][0][0]) => {
    setGrids((gs) =>
      gs
        ? gs.map((g, gi) =>
            gi !== activeSheet
              ? g
              : {
                  ...g,
                  rows: g.rows.map((row, ri) => {
                    if (ri !== r) return row;
                    const padded =
                      row.length > c
                        ? row
                        : [
                            ...row,
                            ...Array.from({ length: c + 1 - row.length }, () => ({
                              v: "",
                              style: null,
                              formula: false,
                            })),
                          ];
                    return padded.map((cell, ci) => (ci !== c ? cell : fn(cell)));
                  }),
                }
          )
        : gs,
    );
  };

  const commitEdit = (r: number, c: number, text: string) => {
    setEditing(null);
    if (!grid || r >= grid.rows.length || c >= colCount) return;
    // a placeholder cell past a ragged csv row's end reads as empty
    const cur = grid.rows[r]?.[c] ?? { v: "", style: null, formula: false };
    if (cur.v === text) return;
    if (mode === "xlsx") {
      const sheet = ws();
      if (!sheet) return;
      try {
        const shown = setCellValue(sheet, r + 1, c + 1, text);
        patchGridCell(r, c, (cell) => ({ ...cell, v: shown }));
      } catch (e) {
        setErr((e as Error).message);
        return;
      }
    } else {
      patchGridCell(r, c, (cell) => ({ ...cell, v: text }));
    }
    markDirty();
    setErr(null);
  };

  const applyStylePatch = (patch: Partial<CellStyle>) => {
    if (!grid || !sel) return;
    if (mode === "csv") {
      setConvertAsk(true); // styling needs a workbook — offer the convert
      return;
    }
    const sheet = ws();
    if (!sheet) return;
    if (sel.kind === "cell") {
      setCellStyle(sheet, sel.r + 1, sel.c + 1, patch);
      patchGridCell(sel.r, sel.c, (cell) => ({
        ...cell,
        style: mergeStyle(cell.style, patch),
      }));
    } else {
      setColumnStyle(sheet, sel.c + 1, patch, grid.rows.length);
      setGrids((gs) =>
        gs
          ? gs.map((g, gi) =>
              gi !== activeSheet
                ? g
                : {
                    ...g,
                    rows: g.rows.map((row) =>
                      row.map((cell, ci) =>
                        ci !== sel.c ? cell : { ...cell, style: mergeStyle(cell.style, patch) },
                      ),
                    ),
                  }
            )
          : gs,
      );
    }
    markDirty();
  };

  const selStyle: CellStyle | null =
    sel?.kind === "cell" ? (grid?.rows[sel.r]?.[sel.c]?.style ?? null) : null;

  const save = async () => {
    if (!grid || saving || !dirty) return;
    // the payload is captured NOW — an edit committed while the write is in
    // flight isn't in it, so `dirty` only clears when the gen didn't move
    const gen = dirtyGen.current;
    setSaving(true);
    setErr(null);
    try {
      if (mode === "xlsx") {
        const wb = wbRef.current;
        if (!wb) return;
        const buffer = await wb.xlsx.writeBuffer();
        // bak=true: exceljs rewrites the whole workbook (exotic features it
        // doesn't model can drop) — Rust keeps a one-time .bak of the original
        await corpusWriteFileBytes(fileId, b64FromBytes(new Uint8Array(buffer)), true);
      } else {
        const rows = grid.rows.map((row) => row.map((cell) => cell.v));
        // bak=true here too: the csv round-trip normalizes quoting/CRLF, so
        // the pre-rotli original survives the first save
        await corpusWriteFileBytes(fileId, b64FromText(csvTextFromRows(rows)), true);
      }
      if (dirtyGen.current === gen) {
        setDirty(false);
        dirtySessions.delete(fileId);
      }
    } catch (e) {
      setErr((e as Error)?.message ?? "couldn't save");
    } finally {
      setSaving(false);
    }
  };
  // ⌘S from an OPEN cell input commits first, then must save the post-commit
  // state — this ref always points at the latest render's save closure
  const saveRef = useRef(save);
  saveRef.current = save;

  /** csv → xlsx: build a sibling workbook (collision-safe on the Rust side),
   * open it in a new tab, and leave the original csv untouched. */
  const convertToXlsx = async () => {
    if (!grid) return;
    setConvertAsk(false);
    try {
      const rows = grid.rows.map((row) => row.map((cell) => cell.v));
      const stem = name.replace(/\.(csv|tsv)$/i, "");
      const wb = fillWorkbookFromRows(new ExcelJS.Workbook(), stem, rows);
      const buffer = await wb.xlsx.writeBuffer();
      const id = await corpusNewFileBytes(
        folderOf(fileId),
        `${stem}.xlsx`,
        b64FromBytes(new Uint8Array(buffer)),
      );
      await invalidateNotes();
      if (id) usePanesStore.getState().openFile(id, { newTab: true });
    } catch (e) {
      setErr((e as Error)?.message ?? "couldn't convert");
    }
  };

  // ⌘S saves; Enter opens the selected cell for editing (input events handle
  // their own keys and stop here via the editing guard)
  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === "Enter" && sel?.kind === "cell" && !editing) {
      const cell = grid?.rows[sel.r]?.[sel.c];
      if (cell && !cell.formula) {
        event.preventDefault();
        setEditing({ r: sel.r, c: sel.c });
      }
    }
  };

  const onCellInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      // ⌘S mid-edit (spreadsheet muscle memory): commit the open cell, then
      // save on the next tick — save() closes over THIS render's grid/dirty,
      // so saving synchronously would miss the cell just committed
      event.preventDefault();
      event.stopPropagation();
      commitEdit(r, c, event.currentTarget.value);
      setTimeout(() => void saveRef.current(), 0);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      commitEdit(r, c, event.currentTarget.value);
      // Enter walks down, Tab walks right — the spreadsheet muscle memory
      const next =
        event.key === "Enter"
          ? { r: Math.min(r + 1, (grid?.rows.length ?? 1) - 1), c }
          : { r, c: Math.min(c + 1, colCount - 1) };
      setSel({ kind: "cell", ...next });
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditing(null);
    }
    event.stopPropagation();
  };

  const startColorPick = (event: ReactMouseEvent<HTMLInputElement>) => {
    // seed the native picker with the selection's current color so "adjust" beats "restart"
    const cur = event.currentTarget.dataset.which === "bg" ? selStyle?.bg : selStyle?.color;
    const hex = hexFromArgb(cur);
    if (hex) event.currentTarget.value = hex;
  };

  if (err && !grid) return <p className="file-err">⚠ {err}</p>;
  if (!grid) return <p className="file-loading">Loading…</p>;

  return (
    <div className="file-sheet sheet-edit" onKeyDown={onRootKeyDown}>
      <div className="sheet-toolbar">
        <button
          type="button"
          className={selStyle?.bold ? "sheet-tool on" : "sheet-tool"}
          title="Bold (selected cell or column)"
          disabled={!sel}
          onClick={() => applyStylePatch({ bold: !(selStyle?.bold ?? false) })}
        >
          B
        </button>
        <label className={sel ? "sheet-tool sheet-color" : "sheet-tool sheet-color off"} title="Text color">
          A
          <input
            type="color"
            data-which="color"
            disabled={!sel}
            onClick={startColorPick}
            onChange={(e) => {
              const argb = argbFromHex(e.target.value);
              if (argb) applyStylePatch({ color: argb });
            }}
          />
        </label>
        <label className={sel ? "sheet-tool sheet-color" : "sheet-tool sheet-color off"} title="Cell / column highlight">
          <span className="sheet-fill-swatch" aria-hidden="true" />
          <input
            type="color"
            data-which="bg"
            disabled={!sel}
            onClick={startColorPick}
            onChange={(e) => {
              const argb = argbFromHex(e.target.value);
              if (argb) applyStylePatch({ bg: argb });
            }}
          />
        </label>
        <button
          type="button"
          className="sheet-tool"
          title="Clear styling"
          disabled={!sel}
          onClick={() => applyStylePatch({ bold: false, color: null, bg: null })}
        >
          ⌀
        </button>
        <span className="sheet-toolbar-space" />
        {err && <span className="sheet-save-err">⚠ {err}</span>}
        {dirty && <span className="sheet-dirty" title="Unsaved changes" />}
        <button type="button" className="sheet-save" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? "Saving…" : dirty ? "Save ⌘S" : "Saved"}
        </button>
      </div>

      {convertAsk && (
        <div className="sheet-convert">
          <span>Styling needs a workbook — convert a copy to .xlsx? The csv stays untouched.</span>
          <button type="button" onClick={() => void convertToXlsx()}>Convert to .xlsx</button>
          <button type="button" className="quiet" onClick={() => setConvertAsk(false)}>Not now</button>
        </div>
      )}

      {grids && grids.length > 1 && (
        <div className="file-sheet-tabs">
          {grids.map((g, i) => (
            <button
              key={g.name}
              type="button"
              className={i === activeSheet ? "fsh-tab on" : "fsh-tab"}
              onClick={() => {
                setActiveSheet(i);
                setSel(null);
                setEditing(null);
              }}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="file-sheet-scroll">
        {grid.rows.length > 0 ? (
          <table className="file-table sheet-grid">
            <tbody>
              <tr>
                {/* the corner — pinned on both axes so it survives two-axis scroll */}
                <td className="fsh-rownum fsh-corner" />
                {Array.from({ length: colCount }, (_, c) => (
                  <th
                    key={c}
                    // tabIndex −1: a click parks focus here, so ⌘S/Enter reach the root handler
                    tabIndex={-1}
                    className={sel?.kind === "col" && sel.c === c ? "sheet-colhead sel" : "sheet-colhead"}
                    onClick={() => {
                      setSel({ kind: "col", c });
                      setEditing(null);
                    }}
                  >
                    {colLabel(c)}
                  </th>
                ))}
              </tr>
              {grid.rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="fsh-rownum">{ri + 1}</td>
                  {Array.from({ length: colCount }, (_, ci) => {
                    const cell = row[ci] ?? { v: "", style: null, formula: false };
                    const selected =
                      (sel?.kind === "cell" && sel.r === ri && sel.c === ci) ||
                      (sel?.kind === "col" && sel.c === ci);
                    const isEditing = editing?.r === ri && editing?.c === ci;
                    return (
                      <td
                        key={ci}
                        tabIndex={-1}
                        className={`sheet-cell${selected ? " sel" : ""}${cell.formula ? " fx" : ""}`}
                        title={cell.formula ? "formula — read-only in rotli" : undefined}
                        style={{
                          fontWeight: cell.style?.bold ? 600 : undefined,
                          color: hexFromArgb(cell.style?.color) ?? undefined,
                          background: hexFromArgb(cell.style?.bg) ?? undefined,
                        }}
                        onClick={() => !isEditing && setSel({ kind: "cell", r: ri, c: ci })}
                        onDoubleClick={() => !cell.formula && setEditing({ r: ri, c: ci })}
                      >
                        {isEditing ? (
                          <input
                            className="sheet-cell-input"
                            defaultValue={cell.v}
                            autoFocus
                            onKeyDown={(e) => onCellInputKeyDown(e, ri, ci)}
                            onBlur={(e) => commitEdit(ri, ci, e.currentTarget.value)}
                          />
                        ) : (
                          cell.v
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="file-loading">(empty sheet)</p>
        )}
      </div>
    </div>
  );
}

function mergeStyle(cur: CellStyle | null, patch: Partial<CellStyle>): CellStyle | null {
  const next: CellStyle = {
    bold: patch.bold ?? cur?.bold ?? false,
    color: patch.color !== undefined ? patch.color : (cur?.color ?? null),
    bg: patch.bg !== undefined ? patch.bg : (cur?.bg ?? null),
  };
  return next.bold || next.color || next.bg ? next : null;
}
