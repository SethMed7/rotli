// Beautified markdown tables (the maintainer, 2026-06-27; interactive 2026-07-01).
// Mirrors blockRender.ts: a StateField replaces each GFM table range with a
// rendered <table> widget. livePreview skips table lines (see lineInTable) so
// the two never collide. The .md is untouched — every edit below is a plain
// text transaction over the table's source range, built from the pure
// transforms in tables.ts.
//
// Cell editing stays inside the rendered table: one focused input replaces one
// cell's display value while every surrounding row and column remains visual.
// Tab/⇧Tab/Enter move between cells and can append a row at the end. Hovering
// the widget shows small row/col chips → a mini menu
// (add/move/delete/align) and +row/+col edges; a `</>` corner chip explicitly
// reveals the whole block raw until the caret leaves the table.

import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { MIN_TABLE_COL_PX, MIN_TABLE_ROW_PX, tableWidthKey, useTableWidthsStore } from "../state/tableWidths";
import { noteIdFacet } from "./livePreview";
import { GRIP_H, GRIP_V, applyOp, openTableMenu } from "./tableMenu";
import {
  type Align,
  type TableBlock,
  type TableShape,
  addColRight,
  addRowBelow,
  fitColumnWidths,
  nextCell,
  scanTables,
  setCellText,
  tableToText,
} from "./tables";

/** Escape HTML, then apply a minimal inline render (bold · italic · code) so cell
 * text reads beautified without opening an HTML-injection hole. */
function inlineCell(raw: string): string {
  let s = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // [text](url) → just the text, styled (a notes app, not a browser)
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '<span class="md-link">$1</span>');
  return s;
}

/** Reveal the whole table raw: the `</>` escape hatch. Cleared automatically
 * when the caret leaves the table (see the field's update). */
export const setTableRaw = StateEffect.define<number>();

function plainCellLabel(raw: string, col: number): string {
  const label = raw
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~=]/g, "")
    .trim();
  return label || `column ${col + 1}`;
}

/** Renders a table (or a headerless run of rows — the split-reveal twins).
 *  - `rowBase`      absolute data-row index of rows[0] (chip menus need it)
 *  - `rowLineDelta` line offset from the widget's start to the first tbody row
 *    (full table: 2 — header + delimiter; below-twin: 0, or 1 when the hidden
 *    delimiter line leads the range)
 *  - `full`         the untouched whole-table widget → +row/+col/`</>` chips */
class TableWidget extends WidgetType {
  constructor(
    readonly header: string[] | null,
    readonly align: Align[],
    readonly rows: string[][],
    readonly cols: number,
    readonly rowBase: number,
    readonly rowLineDelta: number,
    readonly full: boolean,
    /** Position-independent identity for persisted column widths (header
     * signature + occurrence); "" on the headerless split twins. */
    readonly widthSig: string = "",
  ) {
    super();
  }
  /** Live only while a column drag is in flight — destroy() runs it so the
   * window-level drag listeners never outlive the widget (PR #9 review). */
  private dropResizeCleanup: (() => void) | null = null;
  private dropObserver: (() => void) | null = null;
  destroy(): void {
    this.dropResizeCleanup?.();
    this.dropObserver?.();
  }
  eq(o: TableWidget): boolean {
    return (
      JSON.stringify([o.header, o.align, o.rows, o.cols, o.rowBase, o.rowLineDelta, o.full, o.widthSig]) ===
      JSON.stringify([
        this.header,
        this.align,
        this.rows,
        this.cols,
        this.rowBase,
        this.rowLineDelta,
        this.full,
        this.widthSig,
      ])
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.contentEditable = "false";
    // both split twins hug the revealed row (margins collapse to the seam)
    wrap.className = this.full ? "rotli-md-tablewrap" : "rotli-md-tablewrap rotli-md-tablepart";
    const scroll = document.createElement("div");
    scroll.className = "rotli-tbl-scroll";
    const table = document.createElement("table");
    table.className = "rotli-md-table";
    const colAlign = (i: number): Align => this.align[i] ?? "";
    const renderCell = (cell: HTMLTableCellElement, raw: string, row: number, col: number) => {
      cell.dataset.tableRow = String(row);
      cell.dataset.tableCol = String(col);
      cell.dataset.raw = raw;
      cell.tabIndex = 0;
      cell.innerHTML = inlineCell(raw);
    };

    if (this.header) {
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      this.header.forEach((cell, i) => {
        const th = document.createElement("th");
        if (colAlign(i)) th.style.textAlign = colAlign(i);
        renderCell(th, cell, -1, i);
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);
    }

    const tbody = document.createElement("tbody");
    for (let localRow = 0; localRow < this.rows.length; localRow++) {
      const row = this.rows[localRow] ?? [];
      const tr = document.createElement("tr");
      for (let i = 0; i < this.cols; i++) {
        const td = document.createElement("td");
        if (colAlign(i)) td.style.textAlign = colAlign(i);
        renderCell(td, row[i] ?? "", this.rowBase + localRow, i);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    // ── column RESIZE (the maintainer, 2026-07-30): drag a column boundary; widths are
    //    view state persisted per note+table (never the .md), double-click a
    //    boundary to reset the table to auto layout. ──
    const noteId = view.state.facet(noteIdFacet);
    const widthKey = this.full && this.widthSig && noteId ? tableWidthKey(noteId, this.widthSig) : null;
    let userWidths: number[] | null = widthKey
      ? (useTableWidthsStore.getState().widths[widthKey]?.slice() ?? null)
      : null;
    let widthColgroup: HTMLTableColElement[] | null = null;
    const applyColWidths = (cols: number[] | null) => {
      if (cols === null) {
        table.querySelector("colgroup.rotli-tbl-widths")?.remove();
        widthColgroup = null;
        table.style.tableLayout = "";
        table.style.width = "";
        return;
      }
      if (!widthColgroup || widthColgroup.length !== cols.length) {
        table.querySelector("colgroup.rotli-tbl-widths")?.remove();
        const group = document.createElement("colgroup");
        group.className = "rotli-tbl-widths";
        widthColgroup = cols.map(() => {
          const col = document.createElement("col");
          group.appendChild(col);
          return col;
        });
        table.insertBefore(group, table.firstChild);
      }
      // persisted pixels are the user's proportions; the pane's width is the
      // budget — a table wider than its pane scales down together instead of
      // overflowing (2026-09-03), and grows back when the pane does
      const fitted = fitColumnWidths(cols, scroll.clientWidth, MIN_TABLE_COL_PX);
      fitted.forEach((w, i) => {
        const col = widthColgroup?.[i];
        if (col) col.style.width = `${w}px`;
      });
      table.style.tableLayout = "fixed";
      table.style.width = `${fitted.reduce((a, b) => a + b, 0)}px`;
    };
    if (userWidths && userWidths.length === this.cols) applyColWidths(userWidths);
    else userWidths = null;
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        if (userWidths && !wrap.classList.contains("rotli-tbl-resizing")) applyColWidths(userWidths);
      });
      observer.observe(scroll);
      this.dropObserver = () => observer.disconnect();
    }

    // ── row HEIGHTS (2026-07-31, the column story's twin): drag a row's
    //    bottom edge; heights act as minimums (content can still grow a row),
    //    double-click an edge resets. Same key, sibling record. ──
    const rowCount = (this.header ? 1 : 0) + this.rows.length;
    let userHeights: number[] | null = widthKey
      ? (useTableWidthsStore.getState().heights[widthKey]?.slice() ?? null)
      : null;
    const applyRowHeights = (rows: number[] | null) => {
      const trs = Array.from(table.rows);
      trs.forEach((tr, i) => {
        tr.style.height = rows?.[i] != null ? `${rows[i]}px` : "";
      });
    };
    if (userHeights && userHeights.length === rowCount) applyRowHeights(userHeights);
    else userHeights = null;

    /** The column boundary under the pointer (within 5px of a cell edge), or
     * -1. Boundary i sits between column i and i+1 — the last edge is the
     * add-column zone, not a resize. */
    const RESIZE_EDGE = 5;
    const boundaryAt = (e: MouseEvent): number => {
      if (!widthKey) return -1;
      const cell = (e.target as HTMLElement).closest?.("td,th");
      if (!(cell instanceof HTMLTableCellElement)) return -1;
      const col = Number(cell.dataset.tableCol);
      if (!Number.isInteger(col)) return -1;
      const rect = cell.getBoundingClientRect();
      // the pointer must really be AT the cell — the Tab-advance path drives
      // cells with a synthetic mousedown at (0,0), which must never resize
      if (e.clientY < rect.top || e.clientY > rect.bottom) return -1;
      if (e.clientX < rect.left - RESIZE_EDGE || e.clientX > rect.right + RESIZE_EDGE) return -1;
      if (rect.right - e.clientX <= RESIZE_EDGE && col < this.cols - 1) return col;
      if (e.clientX - rect.left <= RESIZE_EDGE && col > 0) return col - 1;
      return -1;
    };
    const currentColWidths = (): number[] => {
      const reference = table.rows.item(0);
      if (!reference) return [];
      return Array.from(reference.cells).map((cell) => cell.getBoundingClientRect().width);
    };
    /** The row boundary under the pointer (within 5px of a row's bottom edge),
     * or -1. Boundary i resizes rendered row i (thead first); the LAST row's
     * bottom edge stays the add-row zone, mirroring the column rule. */
    const rowBoundaryAt = (e: MouseEvent): number => {
      if (!widthKey) return -1;
      const cell = (e.target as HTMLElement).closest?.("td,th");
      if (!(cell instanceof HTMLTableCellElement)) return -1;
      const tr = cell.parentElement;
      if (!(tr instanceof HTMLTableRowElement)) return -1;
      const row = Array.prototype.indexOf.call(table.rows, tr);
      if (row < 0) return -1;
      const rect = cell.getBoundingClientRect();
      // same synthetic-(0,0)-mousedown guard as the column path
      if (e.clientX < rect.left || e.clientX > rect.right) return -1;
      if (e.clientY < rect.top - RESIZE_EDGE || e.clientY > rect.bottom + RESIZE_EDGE) return -1;
      if (rect.bottom - e.clientY <= RESIZE_EDGE && row < rowCount - 1) return row;
      if (e.clientY - rect.top <= RESIZE_EDGE && row > 0) return row - 1;
      return -1;
    };
    const currentRowHeights = (): number[] =>
      Array.from(table.rows).map((tr) => tr.getBoundingClientRect().height);
    const startRowResize = (e: MouseEvent, boundary: number) => {
      if (!widthKey) return;
      // two arrays on purpose (review: transient-height persistence): `visual`
      // is the live snapshot so nothing jumps DURING the drag; `persisted`
      // carries only rows the user explicitly dragged — every other row keeps
      // the harmless MIN floor, so a cell editor's temporarily inflated row
      // can never be baked into settings.json by dragging a different edge.
      const visual = currentRowHeights();
      if (visual.length !== rowCount) return;
      const persisted =
        userHeights?.length === rowCount
          ? userHeights.slice()
          : Array.from({ length: rowCount }, () => MIN_TABLE_ROW_PX);
      const startH = visual[boundary] ?? 0;
      const startY = e.clientY;
      let dragged = Math.max(MIN_TABLE_ROW_PX, startH);
      wrap.classList.add("rotli-tbl-resizing");
      const onMove = (ev: MouseEvent) => {
        dragged = Math.max(MIN_TABLE_ROW_PX, startH + ev.clientY - startY);
        const next = visual.slice();
        next[boundary] = dragged;
        applyRowHeights(next);
        showRowGrip(boundary);
      };
      const onUp = () => {
        cleanupResize();
        hideGrips();
        persisted[boundary] = dragged;
        userHeights = persisted;
        // re-apply the PERSISTED shape — a transiently inflated row snaps back
        // now, not on the next surprise widget rebuild
        applyRowHeights(persisted);
        useTableWidthsStore.getState().setTableHeights(widthKey, persisted);
      };
      const cleanupResize = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        wrap.classList.remove("rotli-tbl-resizing");
        this.dropResizeCleanup = null;
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      this.dropResizeCleanup = cleanupResize;
    };

    const startColResize = (e: MouseEvent, boundary: number) => {
      if (!widthKey) return;
      const startWidths = userWidths?.length === this.cols ? userWidths.slice() : currentColWidths();
      if (startWidths.length !== this.cols) return;
      const startX = e.clientX;
      wrap.classList.add("rotli-tbl-resizing");
      const onMove = (ev: MouseEvent) => {
        const next = startWidths.slice();
        next[boundary] = Math.max(MIN_TABLE_COL_PX, (startWidths[boundary] ?? 0) + ev.clientX - startX);
        userWidths = next;
        applyColWidths(next);
        showColGrip(boundary);
      };
      const onUp = () => {
        cleanupResize();
        hideGrips();
        if (userWidths) useTableWidthsStore.getState().setTableWidths(widthKey, userWidths);
      };
      const cleanupResize = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        wrap.classList.remove("rotli-tbl-resizing");
        this.dropResizeCleanup = null;
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      // CodeMirror may destroy the widget mid-drag (note closed, doc rebuilt)
      // — destroy() runs this so no window listener outlives the widget
      this.dropResizeCleanup = cleanupResize;
    };
    // ── the visible handle (2026-09-03): a line on the boundary under the
    //    pointer, with a small grip pill, so a resizable edge is seen before it
    //    is felt; it stays lit for the whole drag ──
    const colGrip = document.createElement("div");
    colGrip.className = "rotli-tbl-grip col";
    colGrip.setAttribute("aria-hidden", "true");
    const rowGrip = document.createElement("div");
    rowGrip.className = "rotli-tbl-grip row";
    rowGrip.setAttribute("aria-hidden", "true");
    wrap.appendChild(colGrip);
    wrap.appendChild(rowGrip);
    const hideGrips = () => {
      colGrip.classList.remove("on");
      rowGrip.classList.remove("on");
    };
    const showColGrip = (boundary: number) => {
      const cell = table.rows.item(0)?.cells.item(boundary);
      if (!cell) return hideGrips();
      const wrapRect = wrap.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      colGrip.style.left = `${cellRect.right - wrapRect.left - 1}px`;
      colGrip.style.top = `${tableRect.top - wrapRect.top}px`;
      colGrip.style.height = `${tableRect.height}px`;
      colGrip.classList.add("on");
      rowGrip.classList.remove("on");
    };
    const showRowGrip = (boundary: number) => {
      const tr = table.rows.item(boundary);
      if (!tr) return hideGrips();
      const wrapRect = wrap.getBoundingClientRect();
      const rowRect = tr.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      rowGrip.style.top = `${rowRect.bottom - wrapRect.top - 1}px`;
      rowGrip.style.left = `${tableRect.left - wrapRect.left}px`;
      rowGrip.style.width = `${tableRect.width}px`;
      rowGrip.classList.add("on");
      colGrip.classList.remove("on");
    };
    table.addEventListener("mousemove", (e) => {
      if (e.buttons) return; // an active drag owns the cursor and the grip
      // column boundaries win the corner (they came first; rows are the twin)
      const col = boundaryAt(e);
      const row = col >= 0 ? -1 : rowBoundaryAt(e);
      table.style.cursor = col >= 0 ? "col-resize" : row >= 0 ? "row-resize" : "";
      if (col >= 0) showColGrip(col);
      else if (row >= 0) showRowGrip(row);
      else hideGrips();
    });
    wrap.addEventListener("mouseleave", () => {
      if (!wrap.classList.contains("rotli-tbl-resizing")) hideGrips();
    });
    table.addEventListener("dblclick", (e) => {
      if (!widthKey) return;
      if (boundaryAt(e) >= 0) {
        e.preventDefault();
        userWidths = null;
        applyColWidths(null);
        useTableWidthsStore.getState().setTableWidths(widthKey, null);
      } else if (rowBoundaryAt(e) >= 0) {
        e.preventDefault();
        userHeights = null;
        applyRowHeights(null);
        useTableWidthsStore.getState().setTableHeights(widthKey, null);
      }
    });

    // ── click a cell → edit INSIDE the rendered table ─────────────────────
    // The Markdown remains durable truth, but only the active cell becomes a
    // small text control. Every other cell keeps rendering, so entering a table
    // never collapses a whole row into pipe-delimited source.
    type CellTarget = { row: number; col: number };
    let active: {
      cell: HTMLTableCellElement;
      finish: (
        commit: boolean,
        target: CellTarget | null,
        focusAfter: boolean,
        transform?: (shape: TableShape) => TableShape,
      ) => void;
    } | null = null;

    const tableAtWidget = (): TableBlock | null => {
      if (!wrap.isConnected) return null;
      const pos = view.posAtDOM(wrap);
      return (
        scanTables(view.state.doc).find((candidate) => pos >= candidate.from && pos <= candidate.to) ?? null
      );
    };

    const cellAt = (target: CellTarget): HTMLTableCellElement | null =>
      table.querySelector(
        `[data-table-row="${target.row}"][data-table-col="${target.col}"]`,
      ) as HTMLTableCellElement | null;

    /** Hold the rendered column geometry while one cell swaps rich content for
     * a text control. Otherwise auto-layout recomputes around one long editor
     * value and the whole table jumps sideways. */
    const freezeTableGeometry = (): (() => void) => {
      // user column widths already pin the geometry — freezing again would
      // stack a second colgroup over the widths one
      if (table.style.tableLayout === "fixed") return () => {};
      const tableRect = table.getBoundingClientRect();
      const referenceRow = table.rows.item(0);
      if (!referenceRow || tableRect.width <= 0) return () => {};

      const colgroup = document.createElement("colgroup");
      for (const cell of Array.from(referenceRow.cells)) {
        const col = document.createElement("col");
        col.style.width = `${cell.getBoundingClientRect().width}px`;
        colgroup.appendChild(col);
      }

      const previous = {
        width: table.style.width,
        maxWidth: table.style.maxWidth,
        tableLayout: table.style.tableLayout,
      };
      table.insertBefore(colgroup, table.firstChild);
      table.style.width = `${tableRect.width}px`;
      table.style.maxWidth = "none";
      table.style.tableLayout = "fixed";

      return () => {
        colgroup.remove();
        table.style.width = previous.width;
        table.style.maxWidth = previous.maxWidth;
        table.style.tableLayout = previous.tableLayout;
      };
    };

    const focusRebuiltCell = (tableFrom: number, target: CellTarget) => {
      requestAnimationFrame(() => {
        for (const candidate of view.dom.querySelectorAll<HTMLElement>(".rotli-md-tablewrap")) {
          if (!candidate.isConnected || view.posAtDOM(candidate) !== tableFrom) continue;
          const cell = candidate.querySelector(
            `[data-table-row="${target.row}"][data-table-col="${target.col}"]`,
          );
          if (!(cell instanceof HTMLTableCellElement)) return;
          cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
          return;
        }
      });
    };

    const startCellEdit = (cell: HTMLTableCellElement) => {
      const row = Number(cell.dataset.tableRow);
      const col = Number(cell.dataset.tableCol);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;
      if (active?.cell === cell) {
        cell.querySelector<HTMLTextAreaElement>(".rotli-md-cell-input")?.focus();
        return;
      }
      if (active) {
        active.finish(true, { row, col }, true);
        return;
      }

      const original = cell.dataset.raw ?? "";
      const cellRect = cell.getBoundingClientRect();
      const releaseGeometry = freezeTableGeometry();
      const input = document.createElement("textarea");
      input.rows = 1;
      input.className = "rotli-md-cell-input";
      input.value = original;
      const header = this.header?.[col] ?? "";
      input.setAttribute(
        "aria-label",
        `Edit ${plainCellLabel(header, col)} ${row < 0 ? "header" : `row ${row + 1}`}`,
      );
      cell.replaceChildren(input);
      const minimumHeight = Math.max(0, Math.ceil(cellRect.height - 2));
      input.style.minHeight = `${minimumHeight}px`;
      const fitInputHeight = () => {
        input.style.height = "0";
        input.style.height = `${Math.max(minimumHeight, input.scrollHeight)}px`;
      };
      fitInputHeight();

      let finished = false;
      const finish = (
        commit: boolean,
        target: CellTarget | null,
        focusAfter: boolean,
        transform?: (shape: TableShape) => TableShape,
      ) => {
        if (finished) return;
        finished = true;
        active = null;
        releaseGeometry();
        const value = commit ? input.value.replace(/\r?\n/g, " ") : original;
        const current = tableAtWidget();
        if (!current) return;
        let next = commit ? setCellText(current, row, col, value) : current;
        if (!next) return;
        if (transform) next = transform(next);
        const changed = commit && (value !== original || transform != null);
        if (!changed) {
          renderCell(cell, original, row, col);
          if (focusAfter && target) startCellEdit(cellAt(target) ?? cell);
          else if (focusAfter) cell.focus();
          return;
        }
        view.dispatch({
          changes: { from: current.from, to: current.to, insert: tableToText(next) },
        });
        if (focusAfter && target) focusRebuiltCell(current.from, target);
        else if (focusAfter) view.focus();
      };
      active = { cell, finish };

      input.addEventListener("input", fitInputHeight);
      input.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false, { row, col }, true);
          return;
        }
        if (event.key !== "Tab" && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        const current = tableAtWidget();
        if (!current) return;
        let target =
          event.key === "Tab"
            ? nextCell(current, { row, col }, event.shiftKey ? -1 : 1)
            : row < current.rows.length - 1
              ? { row: row + 1, col }
              : null;
        let transform: ((shape: TableShape) => TableShape) | undefined;
        if (target == null && !event.shiftKey) {
          target = { row: current.rows.length, col: event.key === "Tab" ? 0 : col };
          transform = (shape) => addRowBelow(shape, shape.rows.length - 1);
        }
        finish(true, target, true, transform);
      });
      input.addEventListener("blur", () => finish(true, null, false));
      input.focus();
      input.select();
    };

    table.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      // a press on a boundary RESIZES — it must never open the cell editor
      const boundary = boundaryAt(e);
      if (boundary >= 0) {
        e.preventDefault();
        startColResize(e, boundary);
        return;
      }
      const rowBoundary = rowBoundaryAt(e);
      if (rowBoundary >= 0) {
        e.preventDefault();
        startRowResize(e, rowBoundary);
        return;
      }
      const cell = (e.target as HTMLElement).closest?.("td,th");
      if (!(cell instanceof HTMLTableCellElement)) return;
      e.preventDefault();
      startCellEdit(cell);
    });
    table.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLTextAreaElement) return;
      if (event.key !== "Enter" && event.key !== "F2") return;
      const cell = (event.target as HTMLElement).closest?.("td,th");
      if (!(cell instanceof HTMLTableCellElement)) return;
      event.preventDefault();
      event.stopPropagation();
      startCellEdit(cell);
    });

    // ── hover chips: a row grip left of the hovered row, a column grip above
    //    the hovered column; click → the mini menu. Invisible until table hover
    //    (low-pulse); positions are computed per-move, hidden on scroll. ──
    const rowChip = document.createElement("button");
    rowChip.type = "button";
    rowChip.className = "rotli-tbl-chip rowchip";
    rowChip.title = "Row actions";
    rowChip.setAttribute("aria-label", "Row actions");
    rowChip.innerHTML = GRIP_V;
    const colChip = document.createElement("button");
    colChip.type = "button";
    colChip.className = "rotli-tbl-chip colchip";
    colChip.title = "Column actions";
    colChip.setAttribute("aria-label", "Column actions");
    colChip.innerHTML = GRIP_H;
    wrap.appendChild(rowChip);
    wrap.appendChild(colChip);

    let chipRow = -1; // absolute data-row index under the row chip
    let chipCol = -1;
    const hideChips = () => {
      rowChip.classList.remove("on");
      colChip.classList.remove("on");
    };
    table.addEventListener("mousemove", (e) => {
      const cell = (e.target as HTMLElement).closest?.("td,th");
      if (!(cell instanceof HTMLTableCellElement)) return;
      const wrapRect = wrap.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const tr = cell.parentElement as HTMLTableRowElement;
      chipCol = Array.prototype.indexOf.call(tr.cells, cell);
      // col chip pinned to the table's top edge, centered on the hovered column
      colChip.style.left = `${cellRect.left - wrapRect.left + cellRect.width / 2 - 9}px`;
      colChip.style.top = `${tableRect.top - wrapRect.top - 9}px`;
      colChip.classList.add("on");
      if (cell.tagName === "TD") {
        const rowRect = tr.getBoundingClientRect();
        chipRow = this.rowBase + Array.prototype.indexOf.call(tr.parentElement?.children ?? [], tr);
        rowChip.style.left = `${tableRect.left - wrapRect.left - 19}px`;
        rowChip.style.top = `${rowRect.top - wrapRect.top + rowRect.height / 2 - 9}px`;
        rowChip.classList.add("on");
      } else {
        rowChip.classList.remove("on");
      }
    });
    wrap.addEventListener("mouseleave", hideChips);
    scroll.addEventListener("scroll", hideChips, { passive: true });
    for (const [chip, kind] of [
      [rowChip, "row"],
      [colChip, "col"],
    ] as const) {
      chip.addEventListener("mousedown", (e) => e.preventDefault());
      chip.addEventListener("click", () => {
        const index = kind === "row" ? chipRow : chipCol;
        if (index < 0) return;
        openTableMenu(view, wrap, kind, index, this.align[index] ?? "", chip.getBoundingClientRect());
      });
    }

    // ── the full widget's edge affordances: append row/col + the raw hatch ──
    if (this.full) {
      const addRow = document.createElement("button");
      addRow.type = "button";
      addRow.className = "rotli-tbl-append addrow";
      addRow.title = "Add row";
      addRow.setAttribute("aria-label", "Add row");
      addRow.textContent = "+";
      addRow.addEventListener("mousedown", (e) => e.preventDefault());
      addRow.addEventListener("click", () => applyOp(view, wrap, (t) => addRowBelow(t, t.rows.length - 1)));
      wrap.appendChild(addRow);

      const addCol = document.createElement("button");
      addCol.type = "button";
      addCol.className = "rotli-tbl-append addcol";
      addCol.title = "Add column";
      addCol.setAttribute("aria-label", "Add column");
      addCol.textContent = "+";
      addCol.addEventListener("mousedown", (e) => e.preventDefault());
      addCol.addEventListener("click", () => applyOp(view, wrap, (t) => addColRight(t, t.header.length - 1)));
      wrap.appendChild(addCol);

      const rawChip = document.createElement("button");
      rawChip.type = "button";
      rawChip.className = "rotli-tbl-raw";
      rawChip.title = "Edit as markdown";
      rawChip.setAttribute("aria-label", "Edit as markdown");
      rawChip.textContent = "</>";
      rawChip.addEventListener("mousedown", (e) => e.preventDefault());
      rawChip.addEventListener("click", () => {
        const pos = view.posAtDOM(wrap);
        view.dispatch({ selection: { anchor: pos }, effects: setTableRaw.of(pos) });
        view.focus();
      });
      wrap.appendChild(rawChip);
    }

    return wrap;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

// ─── build + field ───────────────────────────────────────────────────────────

const rawLine = Decoration.line({ class: "rotli-table-rawline" });

function build(state: EditorState, tables: TableBlock[], raw: readonly number[]): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const sel = state.selection.main;
  // width identity: header signature + occurrence among same-header tables,
  // so persisted widths survive the table moving within the note
  const sigCounts = new Map<string, number>();
  for (const t of tables) {
    // JSON, not join("|") — an escaped pipe inside a header cell must never
    // collide two different tables onto one widths key (PR #9 review)
    const headerSig = JSON.stringify(t.header);
    const occurrence = sigCounts.get(headerSig) ?? 0;
    sigCounts.set(headerSig, occurrence + 1);
    const wholeRaw = raw.includes(t.from) || (!sel.empty && sel.from <= t.to && sel.to >= t.from);
    if (!wholeRaw) {
      decos.push(
        Decoration.replace({
          widget: new TableWidget(
            t.header,
            t.align,
            t.rows,
            t.header.length,
            0,
            2,
            true,
            `${headerSig}#${occurrence}`,
          ),
          block: true,
        }).range(t.from, t.to),
      );
      continue;
    }
    const head = state.doc.lineAt(t.from);
    const lastNum = state.doc.lineAt(t.to).number;
    // Explicit `</>` source mode (or a real multi-line selection): every line
    // is raw and styled. A plain cell click never comes through this path.
    for (let n = head.number; n <= lastNum; n++) decos.push(rawLine.range(state.doc.line(n).from));
  }
  return Decoration.set(decos, true);
}

interface TableFieldValue {
  deco: DecorationSet;
  tables: TableBlock[];
  /** Table start offsets the `</>` hatch turned whole-raw — pruned as soon as
   * the caret leaves the table, so render always comes back on its own. */
  raw: number[];
}

const tableField = StateField.define<TableFieldValue>({
  create(state) {
    const tables = scanTables(state.doc);
    return { deco: build(state, tables, []), tables, raw: [] };
  },
  update(value, tr) {
    let tables = value.tables;
    let raw = value.raw;
    if (tr.docChanged) {
      raw = raw.map((p) => tr.changes.mapPos(p));
      tables = scanTables(tr.state.doc);
    }
    let hatch = false;
    for (const e of tr.effects) {
      if (e.is(setTableRaw)) {
        raw = [...raw, e.value];
        hatch = true;
      }
    }
    const sel = tr.state.selection.main;
    raw = raw.filter((p) => tables.some((t) => t.from === p && sel.from <= t.to && sel.to >= t.from));
    if (tr.docChanged || tr.selection || hatch) {
      return { deco: build(tr.state, tables, raw), tables, raw };
    }
    return raw.length === value.raw.length ? value : { ...value, raw };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export const tableRender = [tableField];
