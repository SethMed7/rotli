// Beautified markdown tables (Seth, 2026-06-27). Mirrors blockRender.ts: a
// StateField replaces each GFM table range (when the caret isn't inside it) with a
// rendered <table> widget; touch the table and it reveals the raw markdown so you
// can edit it (the Typora/Obsidian live-preview model). livePreview skips table
// lines (see lineInTable) so the two never collide. The .md is untouched.

import { type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type Align, type TableBlock, scanTables } from "./tables";

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

class TableWidget extends WidgetType {
  constructor(readonly t: TableBlock) {
    super();
  }
  eq(o: TableWidget): boolean {
    return JSON.stringify(o.t) === JSON.stringify(this.t);
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "rotli-md-tablewrap";
    const table = document.createElement("table");
    table.className = "rotli-md-table";
    const colAlign = (i: number): Align => this.t.align[i] ?? "";

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    this.t.header.forEach((cell, i) => {
      const th = document.createElement("th");
      if (colAlign(i)) th.style.textAlign = colAlign(i);
      th.innerHTML = inlineCell(cell);
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of this.t.rows) {
      const tr = document.createElement("tr");
      for (let i = 0; i < this.t.header.length; i++) {
        const td = document.createElement("td");
        if (colAlign(i)) td.style.textAlign = colAlign(i);
        td.innerHTML = inlineCell(row[i] ?? "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

function build(state: import("@codemirror/state").EditorState, tables: TableBlock[]): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const sel = state.selection.main;
  for (const t of tables) {
    // reveal-on-caret at block granularity (same test blockRender uses)
    if (sel.from <= t.to && sel.to >= t.from) continue;
    decos.push(Decoration.replace({ widget: new TableWidget(t), block: true }).range(t.from, t.to));
  }
  return Decoration.set(decos, true);
}

const tableField = StateField.define<{ deco: DecorationSet; tables: TableBlock[] }>({
  create(state) {
    const tables = scanTables(state.doc);
    return { deco: build(state, tables), tables };
  },
  update(value, tr) {
    if (tr.docChanged) {
      const tables = scanTables(tr.state.doc);
      return { deco: build(tr.state, tables), tables };
    }
    if (tr.selection) return { deco: build(tr.state, value.tables), tables: value.tables };
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export const tableRender = [tableField];
