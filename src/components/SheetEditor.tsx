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
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import ExcelJS from "exceljs";
import type { Workbook, Worksheet } from "exceljs";
import {
  corpusFileBytes,
  corpusFileText,
  corpusNewFileBytes,
  corpusWriteFileBytes,
} from "../lib/tauri";
import { parseCsvExact } from "../lib/sheets";
import {
  type BorderSides,
  type CellAlign,
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
  deleteCols,
  deleteRows,
  exceedsEditCaps,
  fillWorkbookFromRows,
  gridFromWorkbook,
  hexFromArgb,
  insertCols,
  insertRows,
  setCellStyle,
  setCellValue,
  setColumnStyle,
  trimTrailingEmptyCols,
} from "../lib/sheetEdit";
import { fileName } from "../lib/fileKind";
import { type Sel, activeCell, cellSel, rangeCells, selHas, toggleCell } from "../lib/sheetSelection";
import { useContextMenu } from "../state/contextMenu";
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


/** Refusal message shared by every "the load can't round-trip" guard. */
const TOO_LARGE = "this file is too large to edit in rotli — opening read-only is fine";

/** Toolbar font choices — a small, cross-platform-safe set (Seth, 2026-07-08). */
const FONT_FAMILIES = ["Arial", "Calibri", "Georgia", "Times New Roman", "Courier New", "Verdana"];
const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 24, 32];

/** Per-file SESSION memory for the live⇄in-theme view toggle (Phase D) — the
 * editor unmounts on every tab switch (PaneTree renders only the active tab), so
 * plain state would snap back. Display-only: "live" renders the sheet on a paper
 * canvas with its true colors, like Excel; "theme" (default) lets it blend into
 * rotli. The FILE always keeps the real colors either way. */
const sheetViewMemo = new Map<string, "theme" | "live">();

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
  // held while a drag-select is in progress; a document mouseup ends it
  const draggingRef = useRef(false);
  const openContextMenu = useContextMenu((s) => s.open);
  // live ⇄ in-theme colors (Phase D) — display only, session-sticky per file
  const [view, setView] = useState<"theme" | "live">(() => sheetViewMemo.get(fileId) ?? "theme");
  const toggleView = () => {
    const next = view === "live" ? "theme" : "live";
    setView(next);
    sheetViewMemo.set(fileId, next);
  };
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

  // a drag-select ends wherever the mouse is released (even off the grid)
  useEffect(() => {
    const end = () => {
      draggingRef.current = false;
    };
    document.addEventListener("mouseup", end);
    return () => document.removeEventListener("mouseup", end);
  }, []);

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
    if (sel.kind === "col") {
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
    } else {
      // apply to every selected cell ((rectangle − holes) ∪ extra) — the workbook
      // per cell, then ONE immutable grid rebuild keyed off a membership set
      // (per-cell patchGridCell would rebuild the whole grid N times). A zero-cell
      // selection styles nothing and must not mark dirty (reviewer #2).
      const cells = rangeCells(sel);
      if (cells.length === 0) return;
      for (const { r, c } of cells) setCellStyle(sheet, r + 1, c + 1, patch);
      const keys = new Set(cells.map((x) => `${x.r},${x.c}`));
      setGrids((gs) =>
        gs
          ? gs.map((g, gi) =>
              gi !== activeSheet
                ? g
                : {
                    ...g,
                    rows: g.rows.map((row, ri) =>
                      row.map((cell, ci) =>
                        keys.has(`${ri},${ci}`) ? { ...cell, style: mergeStyle(cell.style, patch) } : cell,
                      ),
                    ),
                  }
            )
          : gs,
      );
    }
    markDirty();
  };

  const applyBorderPreset = (preset: "all" | "bottom" | "none") => {
    if (preset === "none") applyStylePatch({ border: null });
    else if (preset === "all")
      applyStylePatch({ border: { top: true, right: true, bottom: true, left: true } });
    else applyStylePatch({ border: { top: false, right: false, bottom: true, left: false } });
  };

  // ── structural edits (insert/delete rows + columns) ──────────────────────────
  // xlsx: exceljs splice* shifts cells + styles + formulas, then re-derive the
  // grid from the workbook (never diverge). csv: splice the value grid directly.
  const blankCell = (): EditSheet["rows"][0][0] => ({ v: "", style: null, formula: false });
  const structuralOp = (
    mutate: {
      xlsx: (sheet: Worksheet) => void;
      csv: (rows: EditSheet["rows"]) => EditSheet["rows"];
    },
    // only a COLUMN delete needs it — exceljs leaves a phantom trailing column;
    // never trim on insert (it would eat a freshly appended blank column)
    trimCols = false,
  ) => {
    if (!grid) return;
    if (mode === "xlsx") {
      const wb = wbRef.current;
      const sheet = ws();
      if (!wb || !sheet) return;
      mutate.xlsx(sheet);
      const next = gridFromWorkbook(wb);
      setGrids(
        trimCols
          ? next.map((g, gi) =>
              gi === activeSheet ? { ...g, rows: trimTrailingEmptyCols(g.rows) } : g,
            )
          : next,
      );
    } else {
      setGrids((gs) =>
        gs ? gs.map((g, gi) => (gi !== activeSheet ? g : { ...g, rows: mutate.csv(g.rows) })) : gs,
      );
    }
    markDirty();
  };
  const insertRowAt = (at: number, below: boolean) => {
    const idx = below ? at + 1 : at;
    structuralOp({
      xlsx: (sheet) => insertRows(sheet, idx + 1, 1),
      csv: (rows) => [
        ...rows.slice(0, idx),
        Array.from({ length: Math.max(1, colCount) }, blankCell),
        ...rows.slice(idx),
      ],
    });
    setSel(cellSel(idx, 0));
  };
  const deleteRowAt = (at: number) => {
    structuralOp({ xlsx: (sheet) => deleteRows(sheet, at + 1, 1), csv: (rows) => rows.filter((_, i) => i !== at) });
    setSel(null);
    setEditing(null);
  };
  const insertColAt = (at: number, right: boolean) => {
    const idx = right ? at + 1 : at;
    structuralOp({
      xlsx: (sheet) => insertCols(sheet, idx + 1, 1),
      // a ragged row SHORTER than the insert point has nothing at/after idx —
      // leave it alone instead of appending a spurious trailing blank (reviewer
      // nit, Phase C); rows at/beyond idx get the blank spliced in place
      csv: (rows) =>
        rows.map((row) =>
          row.length < idx ? row : [...row.slice(0, idx), blankCell(), ...row.slice(idx)],
        ),
    });
    setSel({ kind: "col", c: idx });
  };
  const deleteColAt = (at: number) => {
    structuralOp(
      {
        xlsx: (sheet) => deleteCols(sheet, at + 1, 1),
        csv: (rows) => rows.map((row) => row.filter((_, i) => i !== at)),
      },
      true, // trim the phantom trailing column exceljs leaves after the delete
    );
    setSel(null);
    setEditing(null);
  };

  // the style the toolbar reflects: the picked cell, or a column's FIRST cell as a
  // representative (so a column's B/I/U/wrap/align toggles read + clear correctly,
  // not just fire "on" — reviewer, Phase A).
  const focus = activeCell(sel);
  // the STYLE focus: if the geometric focus was ⌘-holed OUT of the selection,
  // fall back to the first still-selected cell — the toolbar toggles and the
  // crisp ring must never key off a cell that styling excludes (reviewer #1).
  const styleFocus =
    sel?.kind === "range" && focus && !selHas(sel, focus.r, focus.c)
      ? (rangeCells(sel)[0] ?? null)
      : focus;
  const selStyle: CellStyle | null =
    styleFocus
      ? (grid?.rows[styleFocus.r]?.[styleFocus.c]?.style ?? null)
      : sel?.kind === "col"
        ? (grid?.rows[0]?.[sel.c]?.style ?? null)
        : null;

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
    const active = activeCell(sel);
    // a COLUMN selection has no active cell — an arrow collapses it to the
    // column's first cell so the keyboard can escape it (reviewer nit, Phase B)
    if (!active && sel?.kind === "col" && !editing && event.key.startsWith("Arrow")) {
      event.preventDefault();
      setSel(cellSel(0, sel.c));
      return;
    }
    if (!active || editing) return;
    if (event.key === "Enter") {
      // edit the STYLE focus — a ⌘-holed geometric focus isn't in the selection,
      // so Enter must not open it (reviewer #1)
      const target = styleFocus ?? active;
      const cell = grid?.rows[target.r]?.[target.c];
      if (cell && !cell.formula) {
        event.preventDefault();
        setEditing({ r: target.r, c: target.c });
      }
      return;
    }
    // arrow keys move a single cell; Shift+arrow extends the range's focus
    const dr = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const dc = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (dr || dc) {
      event.preventDefault();
      const nr = Math.max(0, Math.min((grid?.rows.length ?? 1) - 1, active.r + dr));
      const nc = Math.max(0, Math.min(colCount - 1, active.c + dc));
      if (event.shiftKey && sel?.kind === "range") setSel({ ...sel, focus: { r: nr, c: nc } });
      else setSel(cellSel(nr, nc));
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
      setSel(cellSel(next.r, next.c));
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
    <div className={view === "live" ? "file-sheet sheet-edit sheet-live" : "file-sheet sheet-edit"} onKeyDown={onRootKeyDown}>
      <div className="sheet-toolbar">
        <select
          className="sheet-tool-select"
          title="Font"
          disabled={!sel}
          value={selStyle?.fontName ?? ""}
          onChange={(e) => applyStylePatch({ fontName: e.target.value || null })}
        >
          <option value="">Default font</option>
          {/* a cell styled outside the preset list still shows its REAL font
              (reviewer nit, Phase A: the select used to render blank) */}
          {selStyle?.fontName && !FONT_FAMILIES.includes(selStyle.fontName) && (
            <option value={selStyle.fontName}>{selStyle.fontName}</option>
          )}
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          className="sheet-tool-select sheet-tool-size"
          title="Font size"
          disabled={!sel}
          value={selStyle?.fontSize ?? ""}
          onChange={(e) => applyStylePatch({ fontSize: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Size</option>
          {selStyle?.fontSize != null && !FONT_SIZES.includes(selStyle.fontSize) && (
            <option value={selStyle.fontSize}>{selStyle.fontSize}</option>
          )}
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="sheet-tool-sep" aria-hidden="true" />
        <button
          type="button"
          className={selStyle?.bold ? "sheet-tool on" : "sheet-tool"}
          title="Bold"
          disabled={!sel}
          onClick={() => applyStylePatch({ bold: !(selStyle?.bold ?? false) })}
        >
          B
        </button>
        <button
          type="button"
          className={selStyle?.italic ? "sheet-tool on" : "sheet-tool"}
          title="Italic"
          disabled={!sel}
          onClick={() => applyStylePatch({ italic: !(selStyle?.italic ?? false) })}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className={selStyle?.underline ? "sheet-tool on" : "sheet-tool"}
          title="Underline"
          disabled={!sel}
          onClick={() => applyStylePatch({ underline: !(selStyle?.underline ?? false) })}
        >
          <u>U</u>
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
        <label className={sel ? "sheet-tool sheet-color" : "sheet-tool sheet-color off"} title="Fill color">
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
        <span className="sheet-tool-sep" aria-hidden="true" />
        <select
          className="sheet-tool-select"
          title="Borders"
          disabled={!sel}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) applyBorderPreset(v as "all" | "bottom" | "none");
            e.currentTarget.value = "";
          }}
        >
          <option value="">Borders</option>
          <option value="all">All</option>
          <option value="bottom">Bottom</option>
          <option value="none">None</option>
        </select>
        <button
          type="button"
          className={selStyle?.wrap ? "sheet-tool on" : "sheet-tool"}
          title="Wrap text"
          disabled={!sel}
          onClick={() => applyStylePatch({ wrap: !(selStyle?.wrap ?? false) })}
        >
          ⤶
        </button>
        <span className="sheet-tool-sep" aria-hidden="true" />
        {(["left", "center", "right"] as const).map((a) => (
          <button
            key={a}
            type="button"
            disabled={!sel}
            className={selStyle?.align === a ? "sheet-tool on" : "sheet-tool"}
            title={`Align ${a}`}
            onClick={() => applyStylePatch({ align: selStyle?.align === a ? null : (a as CellAlign) })}
          >
            {a === "left" ? "⇤" : a === "center" ? "≡" : "⇥"}
          </button>
        ))}
        <span className="sheet-tool-sep" aria-hidden="true" />
        <button
          type="button"
          className="sheet-tool"
          title="Clear styling"
          disabled={!sel}
          onClick={() =>
            applyStylePatch({
              bold: false,
              italic: false,
              underline: false,
              color: null,
              bg: null,
              fontName: null,
              fontSize: null,
              wrap: false,
              align: null,
              border: null,
            })
          }
        >
          ⌀
        </button>
        <span className="sheet-toolbar-space" />
        <button
          type="button"
          className={view === "live" ? "sheet-tool on" : "sheet-tool"}
          aria-pressed={view === "live"}
          title={
            view === "live"
              ? "Showing true colors on a paper canvas — click to blend into rotli's theme (display only)"
              : "Blending into rotli's theme — click to show the sheet's true colors, like Excel (display only)"
          }
          onClick={toggleView}
        >
          {view === "live" ? "Live" : "Theme"}
        </button>
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
                    title="Click to select · right-click to insert / delete columns"
                    onClick={() => {
                      setSel({ kind: "col", c });
                      setEditing(null);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSel({ kind: "col", c });
                      openContextMenu(e.clientX, e.clientY, [
                        { kind: "action" as const, label: "Insert column left", onClick: () => insertColAt(c, false) },
                        { kind: "action" as const, label: "Insert column right", onClick: () => insertColAt(c, true) },
                        { kind: "sep" as const },
                        { kind: "action" as const, label: "Delete column", danger: true, onClick: () => deleteColAt(c) },
                      ]);
                    }}
                  >
                    {colLabel(c)}
                  </th>
                ))}
              </tr>
              {grid.rows.map((row, ri) => (
                <tr key={ri}>
                  <td
                    className="fsh-rownum"
                    title="Right-click to insert / delete rows"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openContextMenu(e.clientX, e.clientY, [
                        { kind: "action" as const, label: "Insert row above", onClick: () => insertRowAt(ri, false) },
                        { kind: "action" as const, label: "Insert row below", onClick: () => insertRowAt(ri, true) },
                        { kind: "sep" as const },
                        { kind: "action" as const, label: "Delete row", danger: true, onClick: () => deleteRowAt(ri) },
                      ]);
                    }}
                  >
                    {ri + 1}
                  </td>
                  {Array.from({ length: colCount }, (_, ci) => {
                    const cell = row[ci] ?? { v: "", style: null, formula: false };
                    const selected = selHas(sel, ri, ci);
                    // the crisp ring follows the STYLE focus — never a holed cell
                    const isFocus = styleFocus?.r === ri && styleFocus?.c === ci;
                    const isEditing = editing?.r === ri && editing?.c === ci;
                    return (
                      <td
                        key={ci}
                        tabIndex={-1}
                        className={`sheet-cell${selected ? " sel" : ""}${isFocus ? " sel-focus" : ""}${cell.formula ? " fx" : ""}`}
                        title={cell.formula ? "formula — read-only in rotli" : undefined}
                        style={{
                          fontWeight: cell.style?.bold ? 600 : undefined,
                          fontStyle: cell.style?.italic ? "italic" : undefined,
                          textDecoration: cell.style?.underline ? "underline" : undefined,
                          fontFamily: cell.style?.fontName ?? undefined,
                          fontSize: cell.style?.fontSize ? `${cell.style.fontSize}px` : undefined,
                          color: hexFromArgb(cell.style?.color) ?? undefined,
                          background: hexFromArgb(cell.style?.bg) ?? undefined,
                          textAlign: cell.style?.align ?? undefined,
                          whiteSpace: cell.style?.wrap ? "pre-wrap" : undefined,
                          ...borderCss(cell.style?.border),
                        }}
                        onMouseDown={(e) => {
                          if (isEditing) return;
                          // Shift extends the rectangle · ⌘/Ctrl toggles a
                          // discontiguous cell · a plain press starts a drag-range
                          if (e.shiftKey && sel?.kind === "range") {
                            setSel({ ...sel, focus: { r: ri, c: ci } });
                          } else if (e.metaKey || e.ctrlKey) {
                            // toggle membership: inside the rectangle it punches a
                            // hole, outside it adds/removes an extra (toggleCell).
                            // A fully-holed selection collapses to none — controls
                            // disable instead of no-op-applying (reviewer #2).
                            setSel((prev) => {
                              if (prev?.kind !== "range") return cellSel(ri, ci);
                              const next = toggleCell(prev, ri, ci);
                              return next.kind === "range" && rangeCells(next).length === 0
                                ? null
                                : next;
                            });
                          } else {
                            setSel(cellSel(ri, ci));
                            draggingRef.current = true;
                          }
                        }}
                        onMouseEnter={(e) => {
                          // extend only while the primary button is genuinely held —
                          // if a mouseup was lost off-window, buttons===0 self-heals
                          // the drag instead of the selection following the bare cursor
                          if (draggingRef.current && e.buttons === 1)
                            setSel((prev) =>
                              prev?.kind === "range" ? { ...prev, focus: { r: ri, c: ci } } : prev,
                            );
                        }}
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
    italic: patch.italic ?? cur?.italic ?? false,
    underline: patch.underline ?? cur?.underline ?? false,
    color: patch.color !== undefined ? patch.color : (cur?.color ?? null),
    bg: patch.bg !== undefined ? patch.bg : (cur?.bg ?? null),
    fontName: patch.fontName !== undefined ? patch.fontName : (cur?.fontName ?? null),
    fontSize: patch.fontSize !== undefined ? patch.fontSize : (cur?.fontSize ?? null),
    wrap: patch.wrap ?? cur?.wrap ?? false,
    align: patch.align !== undefined ? patch.align : (cur?.align ?? null),
    border: patch.border !== undefined ? patch.border : (cur?.border ?? null),
  };
  const styled =
    next.bold ||
    next.italic ||
    next.underline ||
    !!next.color ||
    !!next.bg ||
    !!next.fontName ||
    next.fontSize !== null ||
    next.wrap ||
    !!next.align ||
    !!next.border;
  return styled ? next : null;
}

/** Per-side CSS borders for a cell's BorderSides (render only; the file keeps the
 * true exceljs border). A theme-muted line so it reads on any background. */
function borderCss(b: BorderSides | null | undefined): CSSProperties {
  if (!b) return {};
  const line = "1px solid var(--text-muted)";
  return {
    ...(b.top ? { borderTop: line } : {}),
    ...(b.right ? { borderRight: line } : {}),
    ...(b.bottom ? { borderBottom: line } : {}),
    ...(b.left ? { borderLeft: line } : {}),
  };
}
