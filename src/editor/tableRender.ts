// Beautified markdown tables (Seth, 2026-06-27; interactive 2026-07-01).
// Mirrors blockRender.ts: a StateField replaces each GFM table range with a
// rendered <table> widget. livePreview skips table lines (see lineInTable) so
// the two never collide. The .md is untouched — every edit below is a plain
// text transaction over the table's source range, built from the pure
// transforms in tables.ts.
//
// Reveal is ROW-granular (the Typora/Obsidian middle path — never whole-table
// "pipe soup"): put the caret in a table and only ITS line shows raw (styled as
// table source); the rows above and below keep rendering as two partial
// widgets. Clicking a cell places the caret inside that cell's source span;
// Tab/⇧Tab/Enter hop cells (cmKeymap.ts). Hovering the widget shows small
// row/col chips → a mini menu (add/move/delete/align) and +row/+col edges; a
// `</>` corner chip reveals the whole block raw (the escape hatch) until the
// caret leaves the table.

import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import {
  type Align,
  type TableBlock,
  type TableShape,
  addColRight,
  addRowBelow,
  cellSpansOf,
  deleteCol,
  deleteRow,
  moveCol,
  moveRow,
  scanTables,
  setColAlign,
  tableToText,
} from "./tables";

/** Escape HTML, then apply a minimal inline render (bold · italic · code) so cell
 * text reads beautified without opening an HTML-injection hole. */
function inlineCell(raw: string): string {
  let s = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

// ─── the row/col mini menu (module-level singleton, like the drop line) ──────

let menuEl: HTMLDivElement | null = null;
let backdropEl: HTMLDivElement | null = null;
function closeTableMenu(): void {
  menuEl?.remove();
  backdropEl?.remove();
  menuEl = null;
  backdropEl = null;
}

/** Resolve the table containing the widget NOW (offsets go stale; posAtDOM at
 * action time is the truth) and replace its source with the transformed text. */
function applyOp(
  view: EditorView,
  wrap: HTMLElement,
  fn: (t: TableBlock) => TableShape | null,
): void {
  if (!wrap.isConnected) return; // the widget was rebuilt/unmounted under the menu
  const pos = view.posAtDOM(wrap);
  const t = scanTables(view.state.doc).find((x) => pos >= x.from && pos <= x.to);
  if (!t) return;
  const next = fn(t);
  if (!next) return;
  view.dispatch({ changes: { from: t.from, to: t.to, insert: tableToText(next) } });
}

function openTableMenu(
  view: EditorView,
  wrap: HTMLElement,
  kind: "row" | "col",
  index: number,
  align: Align,
  anchor: DOMRect,
): void {
  closeTableMenu();
  const backdrop = document.createElement("div");
  backdrop.className = "rotli-block-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closeTableMenu();
  });
  const menu = document.createElement("div");
  menu.className = "rotli-block-menu rotli-tblmenu";
  menu.setAttribute("role", "menu");

  const act = (fn: (t: TableBlock) => TableShape | null) => {
    applyOp(view, wrap, fn);
    closeTableMenu();
    view.focus();
  };
  const item = (label: string, run: () => void, danger = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = danger ? "rotli-block-item danger" : "rotli-block-item";
    b.setAttribute("role", "menuitem");
    b.textContent = label;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", run);
    menu.appendChild(b);
  };

  if (kind === "row") {
    item("Add row above", () => act((t) => addRowBelow(t, index - 1)));
    item("Add row below", () => act((t) => addRowBelow(t, index)));
    item("Move up", () => act((t) => moveRow(t, index, -1)));
    item("Move down", () => act((t) => moveRow(t, index, 1)));
    item("Delete row", () => act((t) => deleteRow(t, index)), true);
  } else {
    // alignment first — a small segmented row (the delimiter cell rewrite)
    const seg = document.createElement("div");
    seg.className = "rotli-tblmenu-align";
    for (const [label, a] of [
      ["⟸", "left"],
      ["⟺", "center"],
      ["⟹", "right"],
    ] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = align === a ? "rotli-tblalign sel" : "rotli-tblalign";
      b.title = `Align ${a}`;
      b.textContent = label;
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => act((t) => setColAlign(t, index, align === a ? "" : a)));
      seg.appendChild(b);
    }
    menu.appendChild(seg);
    item("Add column left", () => act((t) => addColRight(t, index - 1)));
    item("Add column right", () => act((t) => addColRight(t, index)));
    item("Move left", () => act((t) => moveCol(t, index, -1)));
    item("Move right", () => act((t) => moveCol(t, index, 1)));
    item("Delete column", () => act((t) => deleteCol(t, index)), true);
  }

  document.body.appendChild(backdrop);
  document.body.appendChild(menu);
  backdropEl = backdrop;
  menuEl = menu;
  // place beside the chip, clamped to the viewport
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = `${Math.min(anchor.right + 4, window.innerWidth - mw - 8)}px`;
  menu.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - mh - 8))}px`;
}

// ─── the widget ──────────────────────────────────────────────────────────────

// chip glyphs — the block-handle grip voice, sized for an 18px chip
const GRIP_V =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.25"/><circle cx="10" cy="4" r="1.25"/><circle cx="6" cy="8" r="1.25"/><circle cx="10" cy="8" r="1.25"/><circle cx="6" cy="12" r="1.25"/><circle cx="10" cy="12" r="1.25"/></svg>';
const GRIP_H =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="4" cy="6" r="1.25"/><circle cx="4" cy="10" r="1.25"/><circle cx="8" cy="6" r="1.25"/><circle cx="8" cy="10" r="1.25"/><circle cx="12" cy="6" r="1.25"/><circle cx="12" cy="10" r="1.25"/></svg>';

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
  ) {
    super();
  }
  eq(o: TableWidget): boolean {
    return (
      JSON.stringify([o.header, o.align, o.rows, o.cols, o.rowBase, o.rowLineDelta, o.full]) ===
      JSON.stringify([
        this.header,
        this.align,
        this.rows,
        this.cols,
        this.rowBase,
        this.rowLineDelta,
        this.full,
      ])
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    // both split twins hug the revealed row (margins collapse to the seam)
    wrap.className = this.full ? "rotli-md-tablewrap" : "rotli-md-tablewrap rotli-md-tablepart";
    const scroll = document.createElement("div");
    scroll.className = "rotli-tbl-scroll";
    const table = document.createElement("table");
    table.className = "rotli-md-table";
    const colAlign = (i: number): Align => this.align[i] ?? "";

    if (this.header) {
      const thead = document.createElement("thead");
      const htr = document.createElement("tr");
      this.header.forEach((cell, i) => {
        const th = document.createElement("th");
        if (colAlign(i)) th.style.textAlign = colAlign(i);
        th.innerHTML = inlineCell(cell);
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);
    }

    const tbody = document.createElement("tbody");
    for (const row of this.rows) {
      const tr = document.createElement("tr");
      for (let i = 0; i < this.cols; i++) {
        const td = document.createElement("td");
        if (colAlign(i)) td.style.textAlign = colAlign(i);
        td.innerHTML = inlineCell(row[i] ?? "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    // ── click a cell → caret into that cell's source span (click-to-edit) ──
    table.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const cell = (e.target as HTMLElement).closest?.("td,th");
      if (!(cell instanceof HTMLTableCellElement)) return;
      e.preventDefault();
      const tr = cell.parentElement as HTMLTableRowElement;
      const isHead = cell.tagName === "TH";
      const bodyIdx = isHead ? 0 : Array.prototype.indexOf.call(tr.parentElement?.children ?? [], tr);
      const lineOffset = isHead ? 0 : this.rowLineDelta + bodyIdx;
      const startLine = view.state.doc.lineAt(view.posAtDOM(wrap));
      const lineNo = startLine.number + lineOffset;
      if (lineNo < 1 || lineNo > view.state.doc.lines) return;
      const line = view.state.doc.line(lineNo);
      const spans = cellSpansOf(line.text);
      const col = Array.prototype.indexOf.call(tr.cells, cell);
      const sp = spans[Math.min(col, Math.max(0, spans.length - 1))];
      view.dispatch({
        selection: { anchor: line.from + (sp ? sp.end : line.text.length) },
        scrollIntoView: true,
      });
      view.focus();
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
        openTableMenu(
          view,
          wrap,
          kind,
          index,
          this.align[index] ?? "",
          chip.getBoundingClientRect(),
        );
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
      addRow.addEventListener("click", () =>
        applyOp(view, wrap, (t) => addRowBelow(t, t.rows.length - 1)),
      );
      wrap.appendChild(addRow);

      const addCol = document.createElement("button");
      addCol.type = "button";
      addCol.className = "rotli-tbl-append addcol";
      addCol.title = "Add column";
      addCol.setAttribute("aria-label", "Add column");
      addCol.textContent = "+";
      addCol.addEventListener("mousedown", (e) => e.preventDefault());
      addCol.addEventListener("click", () =>
        applyOp(view, wrap, (t) => addColRight(t, t.header.length - 1)),
      );
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
    return false;
  }
}

// ─── build + field ───────────────────────────────────────────────────────────

const rawLine = Decoration.line({ class: "rotli-table-rawline" });

function build(state: EditorState, tables: TableBlock[], raw: readonly number[]): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const sel = state.selection.main;
  for (const t of tables) {
    const touched = sel.from <= t.to && sel.to >= t.from;
    if (!touched) {
      decos.push(
        Decoration.replace({
          widget: new TableWidget(t.header, t.align, t.rows, t.header.length, 0, 2, true),
          block: true,
        }).range(t.from, t.to),
      );
      continue;
    }
    const head = state.doc.lineAt(t.from);
    const lastNum = state.doc.lineAt(t.to).number;
    const selLine = state.doc.lineAt(sel.from);
    const wholeRaw = raw.includes(t.from) || state.doc.lineAt(sel.to).number !== selLine.number;
    if (wholeRaw) {
      // the escape hatch (or a multi-line selection): every line raw, styled
      for (let n = head.number; n <= lastNum; n++) decos.push(rawLine.range(state.doc.line(n).from));
      continue;
    }
    // ROW-granular reveal: only the caret's line is raw; the rest keeps rendering
    const rel = selLine.number - head.number; // 0 header · 1 delimiter · ≥2 data
    decos.push(rawLine.range(selLine.from));
    if (rel >= 1) {
      // header + rows above the caret (caret on the delimiter → header only)
      const aboveTo = state.doc.line(head.number + rel - 1).to;
      decos.push(
        Decoration.replace({
          widget: new TableWidget(
            t.header,
            t.align,
            rel >= 2 ? t.rows.slice(0, rel - 2) : [],
            t.header.length,
            0,
            2,
            false,
          ),
          block: true,
        }).range(t.from, aboveTo),
      );
    }
    if (selLine.number < lastNum) {
      // the rows below the caret — a headerless twin (caret on the header: the
      // hidden delimiter line leads its range, hence rowLineDelta 1)
      const belowFrom = state.doc.line(selLine.number + 1).from;
      const rowBase = rel <= 1 ? 0 : rel - 1;
      decos.push(
        Decoration.replace({
          widget: new TableWidget(
            null,
            t.align,
            t.rows.slice(rowBase),
            t.header.length,
            rowBase,
            rel === 0 ? 1 : 0,
            false,
          ),
          block: true,
        }).range(belowFrom, t.to),
      );
    }
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
